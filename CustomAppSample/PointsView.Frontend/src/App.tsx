import React, { useState, useEffect, useMemo } from 'react';
import { 
  Table, Search, RefreshCw, Activity, CheckCircle, AlertCircle, 
  ArrowUpDown, Server, Network, Hash
} from 'lucide-react';
import './App.css';

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
  stateTextJson?: string;
  trueText?: string;
  falseText?: string;
  lastUpdated?: string;
}

type SortField = 'pointName' | 'unit' | 'presentValue' | 'deviceName' | 'networkName';
type SortOrder = 'asc' | 'desc';

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
  '34': 'watts-per-sq-foot', '35': 'watts-per-sq-meter',
  '36': 'lumens', '37': 'luxes', '38': 'foot-candles',
  '39': 'kilograms', '40': 'pounds-mass', '41': 'tons',
  '42': 'kgs-per-second', '43': 'kgs-per-minute', '44': 'kgs-per-hour',
  '45': 'pounds-mass-per-minute', '46': 'pounds-mass-per-hour',
  '47': 'watts', '48': 'kilowatts', '49': 'megawatts',
  '50': 'BTUs-per-hour', '51': 'horsepower',
  '52': 'tons-refrigeration', '53': 'pascals', '54': 'kilopascals',
  '55': 'bars', '56': 'psi', '57': 'centimeters-of-water',
  '58': 'inches-of-water', '59': 'mm-of-mercury', '60': 'cm-of-mercury',
  '61': 'inches-of-mercury', '62': '°C', '63': '°K',
  '64': '°F', '65': 'degree-days-celsius', '66': 'degree-days-fahrenheit',
  '67': 'years', '68': 'months', '69': 'weeks',
  '70': 'days', '71': 'hours', '72': 'minutes',
  '73': 'seconds', '74': 'meters-per-second', '75': 'km/h',
  '76': 'feet-per-second', '77': 'feet-per-minute', '78': 'mph',
  '79': 'cubic-feet', '80': 'cubic-meters', '81': 'imperial-gallons',
  '82': 'liters', '83': 'us-gallons',
  '84': 'cubic-feet-per-minute', '85': 'cubic-meters-per-second',
  '86': 'imperial-gallons-per-minute', '87': 'liters-per-second',
  '88': 'liters-per-minute', '89': 'us-gallons-per-minute',
  '90': 'degrees-angular', '91': 'degrees-celsius-per-hour',
  '92': 'degrees-celsius-per-minute', '93': 'degrees-fahrenheit-per-hour',
  '94': 'degrees-fahrenheit-per-minute', '95': 'no-units',
  '96': 'parts-per-million', '97': 'parts-per-billion',
  '98': '%', '99': 'percent-per-second',
  '100': 'per-minute', '101': 'per-second',
  '102': 'psi-per-degree-fahrenheit', '103': 'radians',
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
          const idx = Math.round(num) - 1; // 1-indexed for BACnet
          return idx >= 0 && idx < enums.length ? enums[idx] : `State ${Math.round(num)}`;
        }
      } catch { /* ignore */ }
    }
    return String(Math.round(num));
  }

  return num.toFixed(2);
};

export const App: React.FC = () => {
  const [points, setPoints] = useState<PointItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('pointName');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
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
        console.log('PointsView WebSocket connected for live values');
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
                  hasCommunicationError: update.hasCommunicationError !== undefined ? update.hasCommunicationError : p.hasCommunicationError
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

      ws.onerror = (e) => {
        console.warn('PointsView WebSocket error:', e);
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

  const filteredAndSortedPoints = useMemo(() => {
    return points
      .filter(p => {
        const query = searchQuery.toLowerCase().trim();
        if (!query) return true;
        return (
          p.pointName.toLowerCase().includes(query) ||
          p.pointIdentifier.toLowerCase().includes(query) ||
          p.deviceName.toLowerCase().includes(query) ||
          p.networkName.toLowerCase().includes(query) ||
          p.unit.toLowerCase().includes(query)
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
  }, [points, searchQuery, sortField, sortOrder]);

  return (
    <div className="app-container">
      {/* Header Banner */}
      <header className="glass-card header-banner">
        <div className="title-group">
          <Table className="title-icon" size={28} />
          <div className="title-text">
            <h1>PointsView</h1>
            <p>Live Tabular Data View & Real-time Point Explorer</p>
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
            <span className="pulse-dot"></span>
            <span>{wsConnected ? "LIVE UPDATE" : "CONNECTING"}</span>
          </div>

          <button 
            className="btn-icon" 
            onClick={fetchPoints} 
            title="Refresh Data"
            style={{
              padding: '0.6rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              background: 'rgba(15, 23, 42, 0.6)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

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
                  <th>Identifier</th>
                  <th onClick={() => handleSort('unit')}>
                    Unit <ArrowUpDown size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('presentValue')}>
                    Present Value <Activity size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('deviceName')}>
                    Device Name <Server size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th onClick={() => handleSort('networkName')}>
                    Network Name <Network size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedPoints.map(point => {
                  const isUpdated = updatedPointIds.has(point.pointIdentifier);
                  const isOffline = point.hasCommunicationError;

                  return (
                    <tr key={point.id} className={isUpdated ? 'value-updated' : ''}>
                      <td>
                        <div className="point-name">{point.pointName}</div>
                      </td>
                      <td>
                        <span className="point-id">{point.pointIdentifier}</span>
                      </td>
                      <td>
                        <span className="badge-tag">{formatUnitText(point.unit)}</span>
                      </td>
                      <td className="value-cell">
                        {formatValue(point, point.presentValue)}
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
                        <span className={`status-badge ${isOffline ? 'offline' : 'online'}`}>
                          {isOffline ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
                          {isOffline ? 'Offline' : 'Online'}
                        </span>
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
