import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { RegistryEntry } from '../types';

interface ZipSelectProps {
  registry: RegistryEntry[];
  selectedZip: string;
  onChange: (zip: string) => void;
}

const ZipSelect: React.FC<ZipSelectProps> = ({ registry, selectedZip, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedEntry = registry.find(r => r.zip === selectedZip);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    } else {
      setSearch('');
    }
  }, [isOpen]);

  const filteredRegistry = registry.filter(entry => {
    const s = search.toLowerCase();
    return entry.zip.includes(s) || entry.area.toLowerCase().includes(s);
  });

  return (
    <div className="relative flex-1 max-w-[220px]" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-bold py-2.5 pl-3 pr-3 rounded-xl outline-none cursor-pointer focus:ring-2 focus:ring-emerald-500 shadow-sm transition-all"
      >
        <span className="truncate pr-2">
          {selectedEntry ? `${selectedEntry.area} (${selectedEntry.zip})` : 'Select Area...'}
        </span>
        <ChevronDown className={`w-4 h-4 text-emerald-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50">
          <div className="p-2 border-b border-gray-100 flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search zip or area..."
              className="w-full text-xs outline-none"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredRegistry.length === 0 ? (
              <div className="p-3 text-xs text-gray-500 text-center">No areas found</div>
            ) : (
              filteredRegistry.map(entry => (
                <button
                  key={entry.zip}
                  onClick={() => {
                    onChange(entry.zip);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-emerald-50 transition-colors ${
                    selectedZip === entry.zip ? 'bg-emerald-100 font-bold text-emerald-900' : 'text-gray-700'
                  }`}
                >
                  {entry.area} ({entry.zip})
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ZipSelect;
