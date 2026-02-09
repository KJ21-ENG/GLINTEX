import React, { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';
import { cn } from '../../lib/utils'; // Assuming cn utility is available here, otherwise use template literals

const CountdownTimer = () => {
    const [timeLeft, setTimeLeft] = useState('');
    const [colorClass, setColorClass] = useState('bg-green-600 text-white border-transparent dark:bg-green-700 dark:border-green-800');

    useEffect(() => {
        // Configuration
        const startDateStr = import.meta.env.VITE_DEMO_START_DATE;
        const targetDateStr = import.meta.env.VITE_DEMO_END_DATE;

        const startDate = new Date(startDateStr);
        const targetDate = new Date(targetDateStr);
        const totalDuration = targetDate - startDate;

        const calculateTimer = () => {
            const now = new Date();
            const difference = targetDate - now;

            if (difference <= 0) {
                setTimeLeft('Demo Ended');
                // Red color for ended
                setColorClass('bg-red-600 text-white border-transparent dark:bg-red-700 dark:border-red-800');
                return;
            }

            // Calculate Time Text
            const days = Math.floor(difference / (1000 * 60 * 60 * 24));
            const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
            setTimeLeft(`${days}d ${hours}h ${minutes}m left`);

            // Calculate Color Phase
            const elapsed = now - startDate;
            let percentagePassed = 0;

            if (totalDuration > 0) {
                percentagePassed = (elapsed / totalDuration) * 100;
            }

            if (percentagePassed < 33.33) {
                // Green Phase (0-33%) - Fresh
                setColorClass('bg-green-600 text-white border-transparent dark:bg-green-700 dark:border-green-800');
            } else if (percentagePassed < 66.66) {
                // Yellow Phase (33-66%) - Warning
                setColorClass('bg-amber-500 text-white border-transparent dark:bg-amber-600 dark:border-amber-700');
            } else {
                // Red Phase (>66%) - Urgent
                setColorClass('bg-red-600 text-white border-transparent dark:bg-red-700 dark:border-red-800');
            }
        };

        calculateTimer();
        const timer = setInterval(calculateTimer, 60000);

        return () => clearInterval(timer);
    }, []);

    return (
        <div className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md shadow-sm border ${colorClass}`}>
            <Timer className="h-4 w-4" />
            <span>{timeLeft}</span>
        </div>
    );
};

export default CountdownTimer;
