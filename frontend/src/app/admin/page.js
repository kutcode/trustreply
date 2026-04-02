'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import SubTabs from '@/components/SubTabs';
import KBEntriesContent from '@/components/KBEntriesContent';
import FlaggedContent from '@/components/FlaggedContent';
import DuplicatesContent from '@/components/DuplicatesContent';

const KB_TABS = [
    { key: 'entries', label: 'Entries', icon: '📚' },
    { key: 'flagged', label: 'Flagged', icon: '⚑' },
    { key: 'duplicates', label: 'Duplicates', icon: '🔀' },
];

function KBPageInner() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const initialTab = searchParams.get('tab') || 'entries';
    const [activeTab, setActiveTab] = useState(initialTab);

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        router.replace(`/admin?tab=${tab}`, { scroll: false });
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Knowledge Base</h1>
                <p>Manage your Q&A entries, review flagged questions, and resolve duplicates.</p>
            </div>
            <SubTabs tabs={KB_TABS} activeTab={activeTab} onChange={handleTabChange} />
            {activeTab === 'entries' && <KBEntriesContent />}
            {activeTab === 'flagged' && <FlaggedContent />}
            {activeTab === 'duplicates' && <DuplicatesContent />}
        </div>
    );
}

export default function AdminPage() {
    return (
        <Suspense fallback={<div className="page-container"><div className="page-header"><h1>Knowledge Base</h1></div></div>}>
            <KBPageInner />
        </Suspense>
    );
}
