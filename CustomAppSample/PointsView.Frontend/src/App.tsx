import React, { useState, useEffect, useMemo } from 'react';
import { 
  Table, Search, RefreshCw, Activity, CheckCircle, AlertCircle, 
  ArrowUpDown, Server, Network, Hash, Calculator, ToggleLeft, 
  List, Type, Zap, Gauge, Filter
} from 'lucide-react';
import './App.css';
import { useVayuTheme } from './hooks/useVayuTheme';

interface PointItem {
  id: number;
  pointName: string;
  pointIdentifier: string;
  unit: string;
  presentValue: number | null;
  deviceName: string;
  networkName: string;
  hasCommunicationError: boolean;
  objectCategory: string;
  pointType: string;
  protocol: string;
  stateTextJson?: string;
  trueText?: string;
  falseText?: string;
  decimalPrecision?: number;
  isWritable: boolean;
  isManual: boolean;
  isMathBlock: boolean;
  mathExpression?: string;
  operation?: string;
  errorMessage?: string;
  lastUpdated?: string;
}

type SortField = 'pointName' | 'unit' | 'presentValue' | 'deviceName' | 'networkName' | 'pointType' | 'protocol';
type SortOrder = 'asc' | 'desc';
type CategoryFilter = 'All' | 'Analog' | 'Binary' | 'MultiState' | 'Math' | 'Manual' | 'String';

const bacnetUnits: Record<string, string> = {
  '0': 'sq meters', '1': 'sq feet', '2': 'milliamps', '3': 'amps',
  '4': 'ohms', '5': 'volts', '6': 'kilovolts', '7': 'megavolts',
  '8': 'volt-amps', '9': 'kilovolt-amps', '10': 'megavolt-amps',
  '11': 'volt-amps-reactive', '12': 'kilovolt-amps-reactive',
  '13': 'megavolt-amps-reactive', '14': 'degrees-phase',
  '15': 'power-factor', '16': 'joules', '17': 'kilojoules',
  '18': 'watt-hours', '19': 'kilowatt-hours', '20': 'BTUs',
  '21': 'therms', '22': 'ton-hours', '23': 'joules-per-kg-dry-air',
  '24': 'BTUs-per-pound-dry-air', '25': 'cycles-per-hour',
  '26': 'cycles-per-minute', '27': 'hertz', '28': 'grams-of-water-per-kg-dry-air',
  '29': 'percent-relative-humidity', '30': 'millimeters',
  '31': 'meters', '32': 'inches', '33': 'feet',
  '47': 'watts', '48': 'kilowatts', '49': 'megawatts',
  '53': 'pascals', '54': 'kilopascals', '55': 'bars', '56': 'psi',
  '62': '°C', '63': '°K', '64': '°F',
  '71': 'hours', '72': 'minutes', '73': 'seconds',
  '95': 'no-units', '98': '%',
  '104': 'rev-per-minute',
};

const formatUnitText = (rawUnit: string): string => {
  const raw = String(rawUnit ?? '').trim();
  if (!raw || raw === 'Unknown') return 'N/A';
  if (/^\d+$/.test(raw)) {
    return bacnetUnits[raw] || `Unit #${raw}`;
  }
  return raw;
};

const formatValue = (point: PointItem, val: number | null): string => {
  if (val === null || val === undefined) return '--';
  const num = Number(val);
  if (isNaN(num)) return '--';

  const category = point.objectCategory || 'Analog';
  if (category === 'Binary') {
    return num === 1 ? (point.trueText || 'True') : (point.falseText || 'False');
  }

  if (category === 'MultiState') {
    if (point.stateTextJson) {
      try {
        const enums = JSON.parse(point.stateTextJson);
        if (Array.isArray(enums) && enums.length > 0) {
          // Manual enum points use 0-based index, BACnet multi-state uses 1-based
          const idx = point.isManual ? Math.round(num) : Math.round(num) - 1;
          return idx >= 0 && idx < enums.length ? enums[idx] : `State ${Math.round(num)}`;
        }
      } catch { /* ignore */ }
    }
    return String(Math.round(num));
  }

  if (category === 'String') return '--';

  const precision = point.decimalPrecision ?? 2;
  return num.toFixed(precision);
};

const getPointTypeIcon = (pointType: string) => {
  switch (pointType) {
    case 'Numeric': return <Gauge size={13} />;
    case 'Boolean': return <ToggleLeft size={13} />;
    case 'Enum': return <List size={13} />;
    case 'Math': return <Calculator size={13} />;
    case 'String': return <Type size={13} />;
    default: return <Hash size={13} />;
  }
};

const categoryFilters: { key: CategoryFilter; label: string; icon: React.ReactNode }[] = [
  { key: 'All', label: 'All', icon: <Filter size={14} /> },
  { key: 'Analog', label: 'Analog', icon: <Gauge size={14} /> },
  { key: 'Binary', label: 'Binary', icon: <ToggleLeft size={14} /> },
  { key: 'MultiState', label: 'Multi-State', icon: <List size={14} /> },
  { key: 'Math', label: 'Math / Logic', icon: <Calculator size={14} /> },
  { key: 'Manual', label: 'Manual', icon: <Zap size={14} /> },
  { key: 'String', label: 'String', icon: <Type size={14} /> },
];

export const App: React.FC = () => {
  useVayuTheme();
  const [points, setPoints] = useState<PointItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('pointName');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [updatedPointIds, setUpdatedPointIds] = useState<Set<string>>(new Set());
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  // Get authentication token from iframe query param ?token= or localStorage
  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || localStorage.getItem('token') || '';
  }, []);

  const fetchPoints = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/points-view/data', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        throw new Error(`Failed to load points data (${res.status})`);
      }

      const data: PointItem[] = await res.json();
      setPoints(data);
    } catch (e: any) {
      console.error('PointsView fetch error:', e);
      setError(e.message || 'Error fetching points');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPoints();
  }, [token]);

  // WebSocket Live Updates Connection
  useEffect(() => {
    if (!token) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const connectWs = () => {
      if (!isMounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/live?access_token=${token}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data);
          if (update && update.pointIdentifier) {
            setPoints(prev => prev.map(p => {
              if (p.pointIdentifier === update.pointIdentifier) {
                return {
                  ...p,
                  presentValue: update.value !== undefined ? update.value : p.presentValue,
                  hasCommunicationError: update.hasCommunicationError !== undefined ? update.hasCommunicationError : p.hasCommunicationError,
                  errorMessage: update.errorMessage !== undefined ? update.errorMessage : p.errorMessage
                };
              }
              return p;
            }));

            // Flash row update animation
            setUpdatedPointIds(prev => {
              const next = new Set(prev);
              next.add(update.pointIdentifier);
              return next;
            });

            setTimeout(() => {
              setUpdatedPointIds(prev => {
                const next = new Set(prev);
                next.delete(update.pointIdentifier);
                return next;
              });
            }, 1200);
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message in PointsView:', e);
        }
      };

      ws.onerror = () => {
        // silently handled by onclose reconnect
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (isMounted) {
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      };
    };

    connectWs();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [token]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Stats
  const stats = useMemo(() => {
    const total = points.length;
    const online = points.filter(p => !p.hasCommunicationError && !p.errorMessage).length;
    const errors = points.filter(p => p.hasCommunicationError || !!p.errorMessage).length;
    const manual = points.filter(p => p.isManual).length;
    const mathBlocks = points.filter(p => p.isMathBlock).length;
    return { total, online, errors, manual, mathBlocks };
  }, [points]);

  const filteredAndSortedPoints = useMemo(() => {
    return points
      .filter(p => {
        // Category filter
        if (categoryFilter !== 'All') {
          if (categoryFilter === 'Manual') {
            if (!p.isManual) return false;
          } else {
            if (p.objectCategory !== categoryFilter) return false;
          }
        }

        // Search filter
        const query = searchQuery.toLowerCase().trim();
        if (!query) return true;
        return (
          p.pointName.toLowerCase().includes(query) ||
          p.pointIdentifier.toLowerCase().includes(query) ||
          p.deviceName.toLowerCase().includes(query) ||
          p.networkName.toLowerCase().includes(query) ||
          (p.unit && p.unit.toLowerCase().includes(query)) ||
          p.pointType.toLowerCase().includes(query) ||
          p.protocol.toLowerCase().includes(query) ||
          (p.mathExpression && p.mathExpression.toLowerCase().includes(query))
        );
      })
      .sort((a, b) => {
        let valA: any = a[sortField];
        let valB: any = b[sortField];

        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';

        if (typeof valA === 'string') {
          return sortOrder === 'asc' 
            ? valA.localeCompare(valB) 
            : valB.localeCompare(valA);
        }

        return sortOrder === 'asc' 
          ? (valA > valB ? 1 : -1) 
          : (valA < valB ? 1 : -1);
      });
  }, [points, searchQuery, sortField, sortOrder, categoryFilter]);

  return (
    <div className="app-container">
      {/* Header Banner */}
      <header className="glass-card header-banner">
        <div className="title-group">
          <Table className="title-icon" size={28} />
          <div className="title-text">
            <h1>PointsView</h1>
            <p>Live Tabular Data View &amp; Real-time Point Explorer</p>
          </div>
        </div>

        <div className="controls-group">
          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input 
              type="text" 
              placeholder="Search points, devices, networks..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="live-indicator" title={wsConnected ? "Real-time WebSocket connected" : "Connecting..."}>
            <span className={`pulse-dot ${wsConnected ? '' : 'disconnected'}`}></span>
            <span>{wsConnected ? "LIVE" : "OFFLINE"}</span>
          </div>

          <button 
            className="btn-icon" 
            onClick={fetchPoints} 
            title="Refresh Data"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <Hash size={14} />
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-item online">
          <CheckCircle size={14} />
          <span className="stat-value">{stats.online}</span>
          <span className="stat-label">Online</span>
        </div>
        <div className="stat-item error">
          <AlertCircle size={14} />
          <span className="stat-value">{stats.errors}</span>
          <span className="stat-label">Errors</span>
        </div>
        <div className="stat-item manual">
          <Zap size={14} />
          <span className="stat-value">{stats.manual}</span>
          <span className="stat-label">Manual</span>
        </div>
        <div className="stat-item math">
          <Calculator size={14} />
          <span className="stat-value">{stats.mathBlocks}</span>
          <span className="stat-label">Math</span>
        </div>
      </div>

      {/* Category Filter Chips */}
      <div className="filter-chips">
        {categoryFilters.map(cf => (
          <button
            key={cf.key}
            className={`filter-chip ${categoryFilter === cf.key ? 'active' : ''}`}
            onClick={() => setCategoryFilter(cf.key)}
          >
            {cf.icon}
            <span>{cf.label}</span>
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <main className="glass-card" style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading Points Data...</p>
          </div>
        )}

        {error && !loading && (
          <div className="error-container">
            <AlertCircle size={36} color="var(--error-color)" />
            <p>{error}</p>
            <button 
              onClick={fetchPoints}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent-color)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && filteredAndSortedPoints.length === 0 && (
          <div className="empty-container">
            <Hash size={36} />
            <p>No points found matching query.</p>
          </div>
        )}

        {!loading && !error && filteredAndSortedPoints.length > 0 && (
          <div className="table-wrapper">
            <table className="points-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('pointName')}>
                    Point Name <ArrowUpDown size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('pointType')}>
                    Type <ArrowUpDown size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('unit')}>
                    Unit <ArrowUpDown size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('presentValue')}>
                    Value <Activity size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('protocol')}>
                    Protocol <ArrowUpDown size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('deviceName')}>
                    Device <Server size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('networkName')}>
                    Network <Network size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedPoints.map(point => {
                  const isUpdated = updatedPointIds.has(point.pointIdentifier);
                  const isOffline = point.hasCommunicationError;
                  const hasError = !!point.errorMessage;

                  return (
                    <tr 
                      key={point.id} 
                      className={`${isUpdated ? 'value-updated' : ''} ${hasError ? 'has-error' : ''}`}
                      title={hasError ? `Error: ${point.errorMessage}` : ''}
                    >
                      <td>
                        <div className="point-name">{point.pointName}</div>
                        {point.isMathBlock && point.mathExpression && (
                          <div className="math-expr">ƒ {point.mathExpression}</div>
                        )}
                      </td>
                      <td>
                        <span className={`type-badge type-${point.pointType.toLowerCase()}`}>
                          {getPointTypeIcon(point.pointType)}
                          {point.pointType}
                        </span>
                      </td>
                      <td>
                        <span className="badge-tag">{formatUnitText(point.unit)}</span>
                      </td>
                      <td className="value-cell">
                        {formatValue(point, point.presentValue)}
                      </td>
                      <td>
                        <span className={`protocol-badge proto-${point.protocol.toLowerCase()}`}>
                          {point.protocol}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Server size={14} style={{ color: 'var(--text-muted)' }} />
                          {point.deviceName}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Network size={14} style={{ color: 'var(--text-muted)' }} />
                          {point.networkName}
                        </span>
                      </td>
                      <td>
                        {hasError ? (
                          <span className="status-badge error-badge" title={point.errorMessage}>
                            <AlertCircle size={14} />
                            Error
                          </span>
                        ) : (
                          <span className={`status-badge ${isOffline ? 'offline' : 'online'}`}>
                            {isOffline ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
                            {isOffline ? 'Offline' : 'Online'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
