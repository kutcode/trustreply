'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import UserMenu from './UserMenu';

const NAV_LINKS = [
    { href: '/', label: 'Upload', icon: '↑' },
    { href: '/admin', label: 'Knowledge Base', icon: '📚' },
    { href: '/admin/templates', label: 'Templates', icon: '📋' },
    { href: '/troubleshoot', label: 'Troubleshoot', icon: '🛠' },
    { href: '/settings', label: 'Settings', icon: '⚙' },
];

function isActive(href, pathname) {
    if (href === '/') return pathname === '/';
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
}

export default function Navbar() {
    const pathname = usePathname();
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <nav className="navbar">
            <Link href="/" className="navbar-brand" onClick={() => setMenuOpen(false)}>
                <span className="brand-icon">🤖</span>
                TrustReply
            </Link>

            <button
                className="navbar-toggle"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Toggle navigation"
            >
                <span />
                <span />
                <span />
            </button>

            <div className={`navbar-links ${menuOpen ? 'open' : ''}`}>
                {NAV_LINKS.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={isActive(link.href, pathname) ? 'active' : ''}
                        onClick={() => setMenuOpen(false)}
                    >
                        <span className="nav-icon">{link.icon}</span>{' '}
                        {link.label}
                    </Link>
                ))}
            </div>
            <UserMenu />
        </nav>
    );
}
