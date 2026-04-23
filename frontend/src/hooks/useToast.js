import { useState, useCallback, useEffect, useRef } from 'react';

export default function useToast(duration = 4000) {
    const [toast, setToast] = useState(null);
    const timeout = useRef(null);

    useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);

    const showToast = useCallback((message, type = 'info') => {
        if (timeout.current) clearTimeout(timeout.current);
        setToast({ message, type });
        timeout.current = setTimeout(() => setToast(null), duration);
    }, [duration]);

    return { toast, showToast };
}
