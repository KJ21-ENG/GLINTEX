const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 9090;
const MAX_QUEUE = 100;
const jobQueue = [];

const pushJob = (job) => {
    jobQueue.push(job);
    if (jobQueue.length > MAX_QUEUE) jobQueue.splice(0, jobQueue.length - MAX_QUEUE);
};

// Middleware to set Chrome PNA header for all responses
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    next();
});

// Enable CORS for all routes with PNA compatible options
const corsOptions = {
    origin: true, // Reflects the request origin to allow any cloud domain
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Access-Control-Request-Private-Network'],
    optionsSuccessStatus: 204,
    maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Parse JSON bodies
app.use(bodyParser.json());
app.use(bodyParser.text());

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'glintex-local-print-service', port: PORT });
});

app.get('/queue', (req, res) => {
    res.json(jobQueue);
});

// Endpoint to list available printers
app.get('/printers', (req, res) => {
    const platform = os.platform();
    let command = '';

    if (platform === 'win32') {
        command = 'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json"';
    } else {
        command = 'lpstat -e';
    }

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error listing printers: ${error.message}`);
            return res.status(500).json({ error: 'Failed to list printers', details: stderr || error.message });
        }

        let printers = [];
        if (platform === 'win32') {
            try {
                const parsed = JSON.parse(stdout);
                const names = Array.isArray(parsed) ? parsed : [parsed];
                printers = names.map((name) => String(name || '').trim()).filter(Boolean);
            } catch (e) {
                printers = stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            }
        } else {
            printers = stdout
                .trim()
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
        }

        res.json({ printers });
    });
});

// Endpoint to handle print jobs
app.post('/print', (req, res) => {
    const { printer, content, type } = req.body;

    if (!printer || !content) {
        return res.status(400).json({ error: 'Printer name and content are required' });
    }

    const job = {
        id: `job_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        at: new Date().toISOString(),
        printer,
        type: type || 'raw',
        bytes: Buffer.byteLength(String(content || ''), 'utf8'),
        status: 'queued',
    };
    pushJob(job);

    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const tempFilePath = path.join(tempDir, `print_job_${timestamp}.txt`);

    // Write content to a temporary file
    fs.writeFile(tempFilePath, content, (err) => {
        if (err) {
            console.error(`Error writing temp file: ${err.message}`);
            job.status = 'error';
            job.error = err.message;
            return res.status(500).json({ error: 'Failed to process print job' });
        }

        const platform = os.platform();
        let command = '';

        if (platform === 'win32') {
            // Windows: Use PowerShell to send raw bytes to the printer via Win32 API.
            // This allows targeting a specific printer and avoids the "text-only" printing of notepad.
            const psScriptPath = path.join(tempDir, `print_raw_${timestamp}.ps1`);
            const psScript = `
$printerName = "${printer}"
$data = Get-Content -Path "${tempFilePath.replace(/\\/g, '\\\\')}" -Raw -Encoding utf8

$definition = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static bool SendStringToPrinter(string szPrinterName, string szString) {
        IntPtr pBytes;
        Int32 dwCount;
        dwCount = szString.Length;
        pBytes = Marshal.StringToCoTaskMemAnsi(szString);
        bool bSuccess = SendBytesToPrinter(szPrinterName, pBytes, dwCount);
        Marshal.FreeCoTaskMem(pBytes);
        return bSuccess;
    }

    public static bool SendBytesToPrinter(string szPrinterName, IntPtr pBytes, Int32 dwCount) {
        Int32 dwError = 0, dwWritten = 0;
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOA di = new DOCINFOA();
        bool bSuccess = false;

        di.pDocName = "GLINTEX Print Job";
        di.pDataType = "RAW";

        if (OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    bSuccess = WritePrinter(hPrinter, pBytes, dwCount, out dwWritten);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        if (bSuccess == false) {
            dwError = Marshal.GetLastWin32Error();
        }
        return bSuccess;
    }
}
"@
Add-Type -TypeDefinition $definition
[RawPrinterHelper]::SendStringToPrinter($printerName, $data)
`;
            fs.writeFileSync(psScriptPath, psScript);
            command = `powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`;

            // Wrap exec to cleanup the script file too
            const originalExec = exec;
            const customExec = (cmd, cb) => {
                originalExec(cmd, (err, so, se) => {
                    fs.unlink(psScriptPath, (unlErr) => {
                        if (unlErr) console.error(`Error deleting ps1 file: ${unlErr.message}`);
                    });
                    cb(err, so, se);
                });
            };
            customExec(command, (error, stdout, stderr) => {
                // Cleanup temp file
                fs.unlink(tempFilePath, (unlinkErr) => {
                    if (unlinkErr) console.error(`Error deleting temp file: ${unlinkErr.message}`);
                });

                if (error) {
                    console.error(`Error printing: ${error.message}`);
                    job.status = 'error';
                    job.error = stderr || error.message;
                    return res.status(500).json({ error: 'Failed to send print job' });
                }

                console.log(`Print job sent to ${printer}`);
                job.status = 'sent';
                res.json({ success: true, message: 'Print job sent successfully' });
            });
            return; // Exit here as we handled the response in customExec
        } else {
            // Mac/Linux printing using lp
            const options = type === 'raw' ? '-o raw' : '';
            command = `lp -d "${printer}" ${options} "${tempFilePath}"`;
        }

        exec(command, (error, stdout, stderr) => {
            // Cleanup temp file
            fs.unlink(tempFilePath, (unlinkErr) => {
                if (unlinkErr) console.error(`Error deleting temp file: ${unlinkErr.message}`);
            });

            if (error) {
                console.error(`Error printing: ${error.message}`);
                job.status = 'error';
                job.error = stderr || error.message;
                return res.status(500).json({ error: 'Failed to send print job' });
            }

            console.log(`Print job sent to ${printer}`);
            job.status = 'sent';
            res.json({ success: true, message: 'Print job sent successfully' });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Local print service running on http://localhost:${PORT}`);
});
