'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FormatsRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace('/settings?tab=formats'); }, [router]);
    return null;
}
