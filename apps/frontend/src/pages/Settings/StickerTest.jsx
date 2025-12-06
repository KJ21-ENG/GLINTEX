import React, { useState, useEffect } from 'react';

const StickerTest = () => {
    const [printers, setPrinters] = useState([]);
    const [selectedPrinter, setSelectedPrinter] = useState('');
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchPrinters();
    }, []);

    const fetchPrinters = async () => {
        try {
            setLoading(true);
            setStatus('Connecting to local print service...');
            const response = await fetch('http://localhost:9090/printers');
            if (!response.ok) {
                throw new Error('Failed to connect to local print service');
            }
            const data = await response.json();
            setPrinters(data.printers || []);
            if (data.printers && data.printers.length > 0) {
                setSelectedPrinter(data.printers[0]);
            }
            setStatus('Connected');
        } catch (error) {
            console.error('Error fetching printers:', error);
            setStatus('Error: Could not connect to local print service. Make sure it is running on port 9090.');
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = async () => {
        if (!selectedPrinter) {
            setStatus('Please select a printer');
            return;
        }

        try {
            setLoading(true);
            setStatus('Sending print job...');

            const testContent = `
      ^XA
      ^FO50,50^ADN,36,20^FDTest Sticker^FS
      ^FO50,100^ADN,18,10^FDPrinted from Web App^FS
      ^FO50,150^ADN,18,10^FD${new Date().toLocaleString()}^FS
      ^XZ
      `; // Simple ZPL for testing, or just plain text if not using a label printer

            const response = await fetch('http://localhost:9090/print', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    printer: selectedPrinter,
                    content: testContent,
                    type: 'raw' // or 'text' depending on what we want to test
                }),
            });

            const result = await response.json();
            if (result.success) {
                setStatus('Print job sent successfully!');
            } else {
                setStatus('Failed to send print job: ' + result.error);
            }
        } catch (error) {
            console.error('Error printing:', error);
            setStatus('Error printing: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-lg mx-auto bg-white rounded-xl shadow-md space-y-4">
            <h1 className="text-2xl font-bold text-gray-900">Sticker Print Test</h1>

            <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Select Printer</label>
                <select
                    value={selectedPrinter}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                    className="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    disabled={loading || printers.length === 0}
                >
                    {printers.length === 0 && <option>No printers found</option>}
                    {printers.map((printer) => (
                        <option key={printer} value={printer}>
                            {printer}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex space-x-2">
                <button
                    onClick={fetchPrinters}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 focus:outline-none"
                    disabled={loading}
                >
                    Refresh Printers
                </button>
                <button
                    onClick={handlePrint}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none disabled:bg-blue-300"
                    disabled={loading || !selectedPrinter}
                >
                    {loading ? 'Processing...' : 'Test Print'}
                </button>
            </div>

            {status && (
                <div className={`p-4 rounded ${status.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {status}
                </div>
            )}

            <div className="text-sm text-gray-500 mt-4">
                <p>Note: Ensure the local print service is running:</p>
                <code className="block bg-gray-100 p-2 mt-1 rounded">
                    cd apps/local-print-service && node server.js
                </code>
            </div>
        </div>
    );
};

export default StickerTest;
