import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Wrench } from 'lucide-react';

export default function Header() {
    const location = useLocation();

    const isActive = (path: string) => {
        return location.pathname === path;
    };

    const navItems = [
        { path: '/', label: 'Home' },
        { path: '/chat', label: 'Chat' },
        { path: '/editor', label: 'Code Generator' },
        { path: '/skills', label: 'Skills' },
        { path: '/monitoring', label: 'Monitoring' },
    ];

    return (
        <header className="bg-gradient-to-r from-orange-600 via-orange-500 to-orange-600 shadow-lg">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Logo */}
                    <Link to="/" className="flex items-center space-x-3">
                        <Wrench className="w-8 h-8 text-white" />
                        <span className="text-2xl font-bold text-white">CF ToolSmith</span>
                    </Link>

                    {/* Navigation */}
                    <nav className="flex space-x-1">
                        {navItems.map((item) => (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`px-4 py-2 rounded-lg font-medium transition-all ${isActive(item.path)
                                        ? 'bg-white text-orange-600 shadow-md'
                                        : 'text-white hover:bg-orange-400'
                                    }`}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>
            </div>
        </header>
    );
}
