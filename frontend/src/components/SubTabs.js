'use client';

export default function SubTabs({ tabs, activeTab, onChange }) {
    return (
        <div className="sub-tabs">
            {tabs.map((tab) => (
                <button
                    key={tab.key}
                    className={`sub-tab${activeTab === tab.key ? ' sub-tab-active' : ''}`}
                    onClick={() => onChange(tab.key)}
                >
                    {tab.icon && <span className="sub-tab-icon">{tab.icon}</span>}
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
