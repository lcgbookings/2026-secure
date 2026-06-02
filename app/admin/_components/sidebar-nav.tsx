'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import SignOutButton from '../sign-out-button';

type NavLink = { href: string; label: string };

export default function SidebarNav({
  email,
  links,
  children,
}: {
  email: string;
  links: NavLink[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(href + '/');
  }

  const navLinks = (
    <nav className="flex flex-col gap-0.5">
      {links.map((link) => {
        const active = isActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className={
              'text-sm py-2 px-3 rounded-md transition ' +
              (active
                ? 'bg-lcg-deep-teal/8 text-lcg-deep-teal font-medium'
                : 'text-lcg-deep-teal/70 hover:bg-lcg-deep-teal/5')
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarInner = (
    <div className="flex flex-col h-full px-4 py-6">
      <Link
        href="/admin"
        onClick={() => setOpen(false)}
        className="font-serif text-sm leading-tight text-lcg-deep-teal px-3 mb-8 hover:opacity-80 transition block"
      >
        Leadership Communication
        <br />
        Group
      </Link>
      {navLinks}
      <div className="flex-1" />
      <div className="px-3 pt-4 border-t border-lcg-deep-teal/10 flex flex-col gap-1">
        <span className="text-xs text-lcg-deep-teal/60 truncate" title={email}>
          {email}
        </span>
        <SignOutButton />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 bg-lcg-cream border-r border-lcg-deep-teal/10">
        {sidebarInner}
      </aside>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="md:hidden fixed top-3 left-3 z-30 inline-flex items-center justify-center w-10 h-10 rounded-md bg-lcg-cream border border-lcg-deep-teal/10 text-lcg-deep-teal"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-lcg-deep-teal/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 bg-lcg-cream border-r border-lcg-deep-teal/10 shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute top-3 right-3 inline-flex items-center justify-center w-8 h-8 rounded-md text-lcg-deep-teal/70 hover:bg-lcg-deep-teal/5"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 4l10 10M14 4L4 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {sidebarInner}
          </aside>
        </div>
      )}

      <main className="md:pl-72">
        <div className="pt-16 md:pt-0">{children}</div>
      </main>
    </div>
  );
}
