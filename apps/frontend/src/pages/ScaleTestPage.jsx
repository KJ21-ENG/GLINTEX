import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '../components/ui';
import { CatchWeightButton } from '../components/common/CatchWeightButton';
import { isWebSerialSupported, getActiveScalePort, requestScalePort } from '../utils/weightScale';

export function ScaleTestPage() {
    const [weight, setWeight] = useState(null);
    const [logs, setLogs] = useState([]);
    const [isSupported, setIsSupported] = useState(false);
    const [portInfo, setPortInfo] = useState('Not connected');

    useEffect(() => {
        setIsSupported(isWebSerialSupported());
        checkConnection();
    }, []);

    const addLog = (msg) => {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
    };

    const checkConnection = async () => {
        try {
            const port = await getActiveScalePort();
            if (port) {
                setPortInfo('Connected (Authorized)');
                addLog('Found active scale port');
            } else {
                setPortInfo('Not connected');
                addLog('No active scale port found');
            }
        } catch (e) {
            setPortInfo(`Error: ${e.message}`);
            addLog(`Error checking port: ${e.message}`);
        }
    };

    const handleConnect = async () => {
        try {
            addLog('Requesting port...');
            await requestScalePort();
            addLog('Port authorized successfully');
            checkConnection();
        } catch (e) {
            addLog(`Connection failed: ${e.message}`);
        }
    };

    return (
        <div className="p-6 space-y-6 max-w-2xl mx-auto">
            <Card>
                <CardHeader>
                    <CardTitle className="flex justify-between items-center">
                        Scale Test Utility
                        {isSupported ? 
                            <Badge className="bg-green-600">Web Serial Supported</Badge> : 
                            <Badge variant="destructive">Web Serial Not Supported</Badge>
                        }
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    
                    <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                        <div>
                            <div className="text-sm font-medium text-muted-foreground">Status</div>
                            <div className="font-mono">{portInfo}</div>
                        </div>
                        <Button variant="outline" onClick={handleConnect}>
                            Authorize New Port
                        </Button>
                    </div>

                    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg">
                        <div className="text-6xl font-bold font-mono tracking-tighter mb-4">
                            {weight !== null ? weight.toFixed(3) : '---'}
                            <span className="text-2xl text-muted-foreground ml-2">kg</span>
                        </div>
                        
                        <div className="flex gap-4 items-center">
                            <CatchWeightButton 
                                onWeightCaptured={(w) => {
                                    setWeight(w);
                                    addLog(`Captured weight: ${w} kg`);
                                }} 
                                className="h-12 w-12"
                            />
                            <span className="text-sm text-muted-foreground">
                                Click the scale icon to capture
                            </span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium">Activity Log</div>
                        <div className="bg-black/90 text-green-400 font-mono text-xs p-4 rounded h-48 overflow-y-auto">
                            {logs.length === 0 && <span className="opacity-50">No activity...</span>}
                            {logs.map((log, i) => (
                                <div key={i}>{log}</div>
                            ))}
                        </div>
                    </div>

                </CardContent>
            </Card>
        </div>
    );
}
