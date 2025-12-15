const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 9090;

// Middleware to set Chrome PNA header for all responses
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    next();
});

// Enable CORS for all routes with PNA compatible options
app.use(cors({
    origin: true, // Reflects the request origin to allow any cloud domain
    credentials: true // often required specifically for PNA
}));

// Parse JSON bodies
app.use(bodyParser.json());
app.use(bodyParser.text());

// Endpoint to list available printers
app.get('/printers', (req, res) => {
    const platform = os.platform();
    let command = '';

    if (platform === 'win32') {
        command = 'powershell "Get-Printer | Select-Object Name"';
    } else {
        command = 'lpstat -p | awk \'{print $2}\'';
    }

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error listing printers: ${error.message}`);
            return res.status(500).json({ error: 'Failed to list printers' });
        }

        let printers = [];
        if (platform === 'win32') {
            // Parse PowerShell output (skip headers)
            const lines = stdout.trim().split('\r\n');
            if (lines.length > 2) {
                printers = lines.slice(2).map(line => line.trim()).filter(line => line);
            }
        } else {
            // Parse lpstat output
            printers = stdout.trim().split('\n').filter(line => line);
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

    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const tempFilePath = path.join(tempDir, `print_job_${timestamp}.txt`);

    // Write content to a temporary file
    fs.writeFile(tempFilePath, content, (err) => {
        if (err) {
            console.error(`Error writing temp file: ${err.message}`);
            return res.status(500).json({ error: 'Failed to process print job' });
        }

        const platform = os.platform();
        let command = '';

        if (platform === 'win32') {
            // Windows printing (using notepad /p for simple text or other tools for raw)
            // For raw printing (like ZPL), we might need 'copy' to printer share or specific tools.
            // This is a basic implementation.
            command = `notepad /p "${tempFilePath}"`;
            // Better approach for raw printing on windows often involves 'copy' to LPT or network share, 
            // or using a dedicated tool like RawPrint. 
            // For now, let's assume simple text printing or that the user has a setup for this.
            // If it's ZPL, we might want to send it directly to the printer port/share.
            // command = `copy /b "${tempFilePath}" "\\\\localhost\\${printer}"`; // Example for shared printer
        } else {
            // Mac/Linux printing using lp
            // -d specifies destination printer
            // -o raw can be used for raw ZPL/EPL commands if needed
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
                return res.status(500).json({ error: 'Failed to send print job' });
            }

            console.log(`Print job sent to ${printer}`);
            res.json({ success: true, message: 'Print job sent successfully' });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Local print service running on http://localhost:${PORT}`);
});
