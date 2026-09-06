"""Independently reopen files saved by the actual browser, not server reexports."""
import io
import json
import re
import sys
import zipfile
from pathlib import Path
import openpyxl
from pypdf import PdfReader

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/Volumes/MacSSD/tmp/glintex-p3-browser-automated')
preview = json.loads((root / 'normalized-preview.json').read_text())
expected = {s['worker']['reference']: s for s in preview['statements']}
results = []

def pdf_check(data, name, reference=None):
    reader = PdfReader(io.BytesIO(data))
    text = '\n'.join(p.extract_text() for p in reader.pages)
    match = re.search(r'Worker reference: (worker/\d+)', text)
    assert match, name
    worker = match.group(1)
    if reference: assert worker == reference
    statement = expected[worker]
    total = statement['monthlyTotals']
    assert set(re.findall(r'Worker reference: (worker/\d+)', text)) == {worker}
    assert 'fixture-' not in text and 'missing-worker' not in text and 'provenance' not in text
    assert len(re.findall(r'Monthly total\s+630\s+76\.570\*?', text)) == 2
    rows = re.findall(r'Machine 1\s+(\d+)\s+(Unknown|\d+\.\d{3})', text)
    assert len(rows) == total['rowCount'] == 63
    assert sum(int(c) for c, _ in rows) == total['cones']
    assert sum(round(float(kg) * 1000) for _, kg in rows if kg != 'Unknown') == total['netGrams']
    assert sum(kg == 'Unknown' for _, kg in rows) == total['unknownWeightRows']
    daily = re.findall(r'(2026-08-\d{2}) Daily subtotal\s+(\d+)\s+(\d+\.\d{3})\*?', text)
    assert len(daily) == len(statement['dailyTotals'])
    assert [(d, int(c), round(float(kg)*1000)) for d,c,kg in daily] == [(d['date'],d['totals']['cones'],d['totals']['netGrams']) for d in statement['dailyTotals']]
    assert 'Generated:' in text and 'Later edits may change a regenerated statement' in text
    results.append({'file':name,'worker':worker,'rows':len(rows),'pages':len(reader.pages),'cones':total['cones'],'netGrams':total['netGrams'],'unknownWeights':total['unknownWeightRows']})
    return worker

def workbook_check(data, name, reference=None):
    book = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    assert book.sheetnames == ['Summary','Daily Details','Office References']
    header = '\n'.join(str(value) for row in list(book['Summary'].values)[:10] for value in row if value is not None)
    worker = re.search(r'worker/\d+',header).group(0)
    if reference: assert worker == reference
    statement=expected[worker]
    refs=list(book['Office References'].values)[11:]
    assert len(refs)==63
    parity=int(worker.split('/')[1])
    assert all(int(row[1].split('-')[1])%2==parity for row in refs)
    assert sum(row[8] for row in refs)==630
    assert sum(round(row[9]*1000) for row in refs if row[9] is not None)==76570
    assert sum(row[9] is None for row in refs)==statement['monthlyTotals']['unknownWeightRows']
    daily=list(book['Daily Details'].values)[11:]
    raw=[row for row in daily if row[1] not in ('Daily subtotal','Monthly total')]
    assert len(raw)==63
    assert sum(row[3] for row in raw)==630
    assert sum(round(row[4]*1000) for row in raw if row[4] is not None)==76570
    days=[row for row in daily if row[1]=='Daily subtotal']
    assert [(row[0],row[3],round(row[4]*1000)) for row in days]==[(d['date'],d['totals']['cones'],d['totals']['netGrams']) for d in statement['dailyTotals']]
    summary=list(book['Summary'].values)[11:]
    assert summary[-1][0]=='Monthly total' and summary[-1][1]==630 and round(summary[-1][2]*1000)==76570
    assert sum(row[1] for row in summary[:-1])==630
    assert sum(round(row[2]*1000) for row in summary[:-1])==76570
    assert all(isinstance(row[8],(int,float)) and (row[9] is None or isinstance(row[9],(int,float))) for row in refs)
    results.append({'file':name,'worker':worker,'rows':len(refs),'numericCells':True,'privateReferences':True,'cones':630,'netGrams':76570})
    return worker

for extension, check in [('pdf',pdf_check),('xlsx',workbook_check)]:
    with zipfile.ZipFile(root / f'all-{extension}.zip') as archive:
        names=archive.namelist()
        assert len(names)==len(set(names))==2
        assert all('/' not in name and '\\' not in name and '..' not in name for name in names)
        workers={check(archive.read(name),name) for name in names}
        assert workers==set(expected)
    check((root / f'worker.{extension}').read_bytes(),f'worker.{extension}','worker/0')
pdf_check((root / 'mobile-worker.pdf').read_bytes(),'mobile-worker.pdf','worker/1')
(root / 'saved-file-verification.json').write_text(json.dumps(results,indent=2))
print(json.dumps({'verifiedFiles':len(results),'archiveRowsPerFormat':126,'archiveConesPerFormat':1260,'archiveKnownNetKgPerFormat':153.140,'unknownWeightRows':1,'result':'PASS'},indent=2))
