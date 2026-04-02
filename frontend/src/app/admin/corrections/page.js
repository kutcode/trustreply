'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CorrectionsRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace('/settings?tab=learning'); }, [router]);
    return null;
}
