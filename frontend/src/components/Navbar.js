'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navbar() {
    const pathname = usePathname();

    const links = [
        { href: '/', label: 'Upload' },
        { href: '/admin', label: 'Knowledge Base' },
        { href: '/admin/flagged', label: 'Flagged Questions' },
        { href: '/troubleshoot', label: 'Troubleshooting' },
        { href: '/settings', label: 'Settings' },
    ];

    return (
        <nav className="navbar">
            <Link href="/" className="navbar-brand">
                <span className="brand-icon">🤖</span>
                TrustReply
            </Link>
            <div className="navbar-links">
                {links.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={pathname === link.href ? 'active' : ''}
                    >
                        {link.label}
                    </Link>
                ))}
            </div>
        </nav>
    );
}
