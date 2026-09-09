# August coning total reconciliation

Verified 2026-09-09 against VPS 72.61.228.188, database glintex, role glintex, container glintex-app-db-1. Database connections used explicit READ ONLY transactions. Production checkout and local source HEAD: 3c666af37dde10486b1f7e70b3b2781ef2c70731. Deployed backend service code was also executed inside a read-only Prisma transaction.

## Exact reproduction

Period: 2026-08-01 through 2026-08-31.
Contractor: Birendra bhai. Draft settlement: cmttva3gs06h5pk4hw58iou90, created 2026-09-09 08:59:15.622 UTC. Stored amount: 332401.60, matching photographed document.

| Component | Receive rows | Cones | Net kg |
|---|---:|---:|---:|
| Production report | 1871 | 189088 | 26619.8649 |
| Opening marker exclusions | 20 | 1561 | 236.250 |
| No-rate blockers, all FIRKI | 8 | 4823 | 136.126 |
| Included live rows | 1843 | 182704 | 26247.4889 |
| Settlement after per-line rounding | 1843 | 182704 | 26247.498 |

26619.8649 - 236.250 - 136.126 + 0.0091 = 26247.498.
Displayed difference: 372.367 kg. No rows are claimed by other settlements, and no included row differs from its stored snapshot by more than rounding tolerance. Re-running computePayablePreview excluding this settlement's own claims exactly reproduced 26247.498 kg, 1843 payable rows, 20 opening exclusions and 8 no_rate blockers.

## Root cause

Production report includes all non-deleted receive rows dated in the period (routes/index.js:18161). Contractor payable preview explicitly excludes opening markers and omits rows without matching rates (services/contractorPayments/service.js:512 and :557). Thus these screens use different inclusion rules. The PDF is a payable subset, not a complete production total.

Opening rows have createdBy=opening and OP-prefixed lots. This proves their current classification, not whether users classified every physical transaction correctly.

Missing rate combinations all use 100 POLYESTER, cut 50/69, Z-Twist, BALAJI cone:
- B/S WATER 11-SUMI, BOTH side: 7 rows, 123.096 kg.
- S/S SRT SILVER-SML, SINGLE side: 1 row, 13.030 kg.

Affected barcodes:
RCO-3914-C001, RCO-3914-C002, RCO-3957-C001, RCO-4001-C001, RCO-4001-C002, RCO-4045-C001, RCO-4046-C001, RCO-4173-C001.

Recommended action: configure the agreed contractor rates for these qualities and regenerate/recalculate the draft. Review opening classification if these rows actually represent new contractor work. Present opening exclusions and unpriced production explicitly so report and payable totals can be reconciled. Use consistent rounding if exact displayed equality is required. No rate value can be inferred from this investigation.

## Separate issue visible in the screenshot

Total Issued 26186589.000 and resulting wastage/efficiency are incorrect. The report calls JSON.parse on receivedRowRefs even though Prisma returns JSON arrays. Its fallback multiplies expectedCones by requiredPerConeNetWeight (grams), without converting to kilograms. The VPS has 627 August coning issues; all refs values are objects, and the sum of this fallback product is exactly 26186589, reproducing the screenshot. Creation code uses totalIssueWeightKg * 1000 / requiredPerConeNetWeight, confirming gram units. References: routes/index.js:18141-18157, :10887, :14039. Fix must correctly read JSON refs and account for actual allocated source weights, with unit conversion on any fallback. This separate defect does not cause the Received-versus-settlement mismatch.

No application code, production data, rates, settlements, or deployed services were changed.
