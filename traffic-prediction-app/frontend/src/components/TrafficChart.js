import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import * as tt from '@tomtom-international/web-sdk-services';
import * as ttmaps from '@tomtom-international/web-sdk-maps';
import { TOMTOM_API_KEY, WEATHER_API_KEY, GOOGLE_MAPS_API_KEY } from '../config';
import { LoadScript } from '@react-google-maps/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";

const formatXAxis = (hour) => {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}${ampm}`;
};

function TrafficChart() {
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedDestination, setSelectedDestination] = useState("");
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const mapElement = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const sourceRef = useRef(null);
  const destinationRef = useRef(null);

  useEffect(() => {
    let map = null;
    
    if (mapElement.current) {
      map = ttmaps.map({
        key: TOMTOM_API_KEY,
        container: mapElement.current,
        center: [77.5946, 12.9716],
        zoom: 12
      });
    }

    return () => {
      if (map) {
        map.remove();
      }
    };
  }, []);

  const getTrafficData = async (source, destination) => {
    try {
      setLoading(true);
      setError("");
      setProgress(0);
      setChartData([]);

      const sourceWithState = `${source}, India`;
      const destWithState = `${destination}, India`;

      const sourceRes = await tt.services.fuzzySearch({
        key: TOMTOM_API_KEY,
        query: sourceWithState
      });
      const destRes = await tt.services.fuzzySearch({
        key: TOMTOM_API_KEY,
        query: destWithState
      });

      if (!sourceRes.results.length || !destRes.results.length) {
        throw new Error("Could not find coordinates for the specified locations");
      }

      const sourceLoc = sourceRes.results[0].position;
      const destLoc = destRes.results[0].position;

      const weatherRes = await axios.get(
        `https://api.openweathermap.org/data/2.5/forecast?lat=${destLoc.lat}&lon=${destLoc.lng}&appid=${WEATHER_API_KEY}&units=metric`
      );

      const initialHourlyData = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        travel_time: 0,
        traffic_delay: 0,
        traffic_length: 0,
        departure_time: 'Fetching...',
        arrival_time: 'Fetching...',
        weather: 'Fetching...',
        temperature: 'N/A',
        traffic_level: 'Fetching...'
      }));

      setChartData(initialHourlyData);

      const currentDate = new Date();
      for (let i = 0; i < 24; i++) {
        try {
          const departAt = new Date(currentDate);
          departAt.setHours(i, 0, 0, 0);
          const formattedDate = departAt.toISOString();

          const routeRes = await axios.get(
            `https://api.tomtom.com/routing/1/calculateRoute/${sourceLoc.lat},${sourceLoc.lng}:${destLoc.lat},${destLoc.lng}/json`,
            {
              params: {
                key: TOMTOM_API_KEY,
                traffic: true,
                departAt: formattedDate
              }
            }
          );

          const route = routeRes.data.routes[0];
          const summary = route.summary;
          
          const weatherHour = weatherRes.data.list.find(item => 
            new Date(item.dt * 1000).getHours() === i
          );

          setChartData(prevData => {
            const newData = [...prevData];
            newData[i] = {
              hour: i,
              travel_time: Math.round(summary.travelTimeInSeconds / 60),
              traffic_delay: Math.round(summary.trafficDelayInSeconds / 60),
              traffic_length: summary.trafficLengthInMeters,
              total_distance: summary.lengthInMeters,
              departure_time: new Date(summary.departureTime).toLocaleTimeString(),
              arrival_time: new Date(summary.arrivalTime).toLocaleTimeString(),
              weather: weatherHour ? weatherHour.weather[0].main : 'N/A',
              temperature: weatherHour ? Math.round(weatherHour.main.temp) : 'N/A',
              traffic_level: getTrafficLevel(summary.trafficDelayInSeconds)
            };
            return newData;
          });

          setProgress(Math.round(((i + 1) / 24) * 100));

          if (i < 23) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (err) {
          console.error(`Error fetching data for hour ${i}:`, err);
        }
      }
    } catch (error) {
      setError(error.message);
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
      setProgress(100);
    }
  };

  const getTrafficLevel = (delay) => {
    if (delay < 300) return 'Low';
    if (delay < 600) return 'Medium';
    return 'High';
  };

  const fetchPlaceSuggestions = (input) => {
    if (!window.google?.maps?.places?.AutocompleteService) return;
    const svc = new window.google.maps.places.AutocompleteService();
    setIsLoadingSuggestions(true);
    svc.getPlacePredictions({ input, componentRestrictions: { country: 'in' } }, (predictions) => {
      setSuggestions(predictions || []);
      setIsLoadingSuggestions(false);
    });
  };

  const handleInputChange = (value, field) => {
    if (field === 'source') setSelectedSource(value);
    if (field === 'destination') setSelectedDestination(value);
    if (value.length > 2) {
      setActiveField(field);
      setShowSuggestions(true);
      fetchPlaceSuggestions(value);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  const handleSuggestionClick = (prediction) => {
    const description = prediction.description || '';
    if (activeField === 'source') setSelectedSource(description);
    if (activeField === 'destination') setSelectedDestination(description);
    setShowSuggestions(false);
    setActiveField(null);
  };

  useEffect(() => {
    const onDocClick = (e) => {
      if (
        sourceRef.current && !sourceRef.current.contains(e.target) &&
        destinationRef.current && !destinationRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
        setActiveField(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSource || !selectedDestination) {
      setError("Please enter both source and destination locations");
      return;
    }
    await getTrafficData(selectedSource, selectedDestination);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h2 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-3">
            Traffic Intelligence
          </h2>
          <p className="text-gray-600 text-lg">Real-time route analysis powered by AI</p>
        </div>
        
        <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY} libraries={["places"]}>
          {/* Form Card */}
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 md:p-8 mb-8 shadow-xl border border-white">
            <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 items-stretch md:items-center">
              {/* Source Input */}
              <div className="flex-1 relative group" ref={sourceRef}>
                <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-400 to-purple-400 rounded-2xl opacity-0 group-hover:opacity-100 transition duration-300 blur"></div>
                <div className="relative">
                  <input
                    type="text"
                    value={selectedSource}
                    onChange={(e) => handleInputChange(e.target.value, 'source')}
                    onFocus={() => {
                      if (selectedSource.length > 2) {
                        setActiveField('source');
                        setShowSuggestions(true);
                        fetchPlaceSuggestions(selectedSource);
                      }
                    }}
                    placeholder="Starting point"
                    className="w-full px-5 py-4 bg-white text-gray-800 rounded-2xl border-2 border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all placeholder-gray-400"
                  />
                  {showSuggestions && activeField === 'source' && suggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-2 bg-white border-2 border-gray-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                      {suggestions.map((p) => (
                        <button
                          key={p.place_id}
                          type="button"
                          className="block w-full text-left px-5 py-3 text-gray-700 hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 transition-all border-b border-gray-100 last:border-0"
                          onClick={() => handleSuggestionClick(p)}
                        >
                          {p.description}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Destination Input */}
              <div className="flex-1 relative group" ref={destinationRef}>
                <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-400 to-pink-400 rounded-2xl opacity-0 group-hover:opacity-100 transition duration-300 blur"></div>
                <div className="relative">
                  <input
                    type="text"
                    value={selectedDestination}
                    onChange={(e) => handleInputChange(e.target.value, 'destination')}
                    onFocus={() => {
                      if (selectedDestination.length > 2) {
                        setActiveField('destination');
                        setShowSuggestions(true);
                        fetchPlaceSuggestions(selectedDestination);
                      }
                    }}
                    placeholder="Destination"
                    className="w-full px-5 py-4 bg-white text-gray-800 rounded-2xl border-2 border-gray-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none transition-all placeholder-gray-400"
                  />
                  {showSuggestions && activeField === 'destination' && suggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-2 bg-white border-2 border-gray-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                      {suggestions.map((p) => (
                        <button
                          key={p.place_id}
                          type="button"
                          className="block w-full text-left px-5 py-3 text-gray-700 hover:bg-gradient-to-r hover:from-purple-50 hover:to-pink-50 transition-all border-b border-gray-100 last:border-0"
                          onClick={() => handleSuggestionClick(p)}
                        >
                          {p.description}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button 
                type="submit"
                disabled={loading || !selectedSource || !selectedDestination}
                className={`px-8 py-4 rounded-2xl font-semibold text-white transition-all duration-300 transform hover:scale-105 shadow-lg ${
                  loading || !selectedSource || !selectedDestination
                    ? 'bg-gray-300 cursor-not-allowed opacity-60' 
                    : 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 hover:shadow-xl hover:shadow-purple-300'
                }`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Analyzing...
                  </span>
                ) : 'Analyze Route'}
              </button>
            </form>
          </div>
        </LoadScript>

        {/* Progress Bar */}
        {loading && (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 mb-8 shadow-lg border border-white">
            <div className="relative w-full h-3 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-pulse"></div>
              </div>
            </div>
            <p className="text-center text-gray-700 mt-3 font-medium">
              Fetching traffic data: {progress}%
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 mb-8 shadow-lg">
            <p className="text-red-600 text-center font-medium">{error}</p>
          </div>
        )}

        {/* Chart */}
        {chartData.length > 0 && !error && (
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-6 md:p-8 shadow-xl border border-white">
            <div className="mb-6">
              <h3 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                24-Hour Traffic Analysis
              </h3>
              <p className="text-gray-600">Hover over bars for detailed insights</p>
            </div>
            <div className="bg-gradient-to-br from-blue-50/50 to-purple-50/50 rounded-2xl p-6">
              <ResponsiveContainer width="100%" height={500}>
                <BarChart 
                  data={chartData}
                  margin={{ top: 20, right: 20, left: 0, bottom: 60 }}
                >
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9}/>
                      <stop offset="50%" stopColor="#a855f7" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#ec4899" stopOpacity={0.9}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" opacity={0.5} />
                  <XAxis 
                    dataKey="hour"
                    tickFormatter={formatXAxis}
                    interval={0}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    stroke="#64748b"
                    style={{ fontSize: '12px', fontWeight: '500' }}
                    label={{ 
                      value: 'Time of Day', 
                      position: 'insideBottom',
                      offset: -10,
                      style: { fill: '#475569', fontSize: '14px', fontWeight: 'bold' }
                    }}
                  />
                  <YAxis 
                    stroke="#64748b"
                    style={{ fontSize: '12px', fontWeight: '500' }}
                    label={{ 
                      value: 'Travel Time (minutes)', 
                      angle: -90, 
                      position: 'insideLeft',
                      offset: 10,
                      style: { fill: '#475569', fontSize: '14px', fontWeight: 'bold' }
                    }}
                  />
                  <Tooltip content={CustomTooltip} cursor={{ fill: 'rgba(147, 197, 253, 0.2)' }} />
                  <Legend 
                    verticalAlign="top" 
                    height={36}
                    wrapperStyle={{ color: '#475569', fontSize: '14px', fontWeight: '600' }}
                  />
                  <Bar 
                    dataKey="travel_time" 
                    name="Travel Time"
                    fill="url(#barGradient)"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const formattedHour = formatXAxis(data.hour);
    return (
      <div className="bg-white/95 backdrop-blur-sm border-2 border-blue-200 rounded-2xl p-5 shadow-2xl max-w-xs">
        <div className="flex items-center gap-2 mb-3 pb-3 border-b-2 border-gray-200">
          <div className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"></div>
          <p className="font-bold text-blue-600 text-lg">{formattedHour}</p>
        </div>
      
        {data.travel_time > 0 ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Travel Time:</span>
              <span className="text-blue-600 font-semibold">{data.travel_time} mins</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Traffic Delay:</span>
              <span className="text-purple-600 font-semibold">{data.traffic_delay} mins</span>
            </div>
            

            <div className="pt-2 mt-2 border-t-2 border-gray-200">
              <div className="flex justify-between items-center mb-1">
                <span className="text-gray-600">Departure:</span>
                <span className="text-gray-800 text-xs font-medium">{data.departure_time}</span>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-gray-600">Arrival:</span>
                <span className="text-gray-800 text-xs font-medium">{data.arrival_time}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Traffic Level:</span>
                <span className={`font-semibold ${
                  data.traffic_level === 'Low' ? 'text-green-600' :
                  data.traffic_level === 'Medium' ? 'text-yellow-600' :
                  'text-red-600'
                }`}>{data.traffic_level}</span>
              </div>
            </div>
            <div className="pt-2 mt-2 border-t-2 border-gray-200">
              <div className="flex justify-between items-center mb-1">
                <span className="text-gray-600">Weather:</span>
                <span className="text-gray-800 font-medium">{data.weather}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Temperature:</span>
                <span className="text-gray-800 font-medium">{data.temperature}°C</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No route data available</p>
        )}
      </div>
    );
  }
  return null;
};


export default TrafficChart;