import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import './App.css'

type Analysis = { condition: string; icon: string; cloudCover: number; rainLikelihood: string; temperatureEstimate: { value: number; unit: string; confidence: string }; humidityEstimate: string; visibilityEstimate: string; confidence: number; visualEvidence: string[]; explanation: string }
type HistoryItem = { id: number; date: string; location: string; image: string; ai: string; actual: string; score: number }
type ActualWeather = { condition: string; icon: string; temperature: number; cloudCover: number; humidity: number; visibility: number; rain: number; wind: number; sunrise?: string; sunset?: string }
const initialWeather: ActualWeather = { condition: 'Waiting', icon: '⌁', temperature: 0, cloudCover: 0, humidity: 0, visibility: 0, rain: 0, wind: 0 }
const defaultLocation = 'Thrissur, Kerala'

const weatherLabel = (code: number) => code >= 95 ? ['Thunderstorm', '⛈️'] : code >= 51 ? ['Rainy', '🌧️'] : code >= 45 ? ['Foggy', '🌫️'] : code >= 3 ? ['Cloudy', '☁️'] : code >= 1 ? ['Partly cloudy', '🌤️'] : ['Sunny', '☀️']
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const currentTimeValue = () => new Date().toTimeString().slice(0, 5)
const timeDifference = (first: string, second: string) => {
  const toMinutes = (value: string) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes }
  const difference = Math.abs(toMinutes(first) - toMinutes(second))
  return Math.min(difference, 1440 - difference)
}

async function estimatePhotoTime(image: string): Promise<string> {
  const imageElement = new Image()
  imageElement.src = image
  await new Promise<void>((resolve, reject) => { imageElement.onload = () => resolve(); imageElement.onerror = () => reject(new Error('Invalid image')) })
  const canvas = document.createElement('canvas')
  canvas.width = 32; canvas.height = 32
  const context = canvas.getContext('2d')
  context?.drawImage(imageElement, 0, 0, 32, 32)
  const pixels = context?.getImageData(0, 0, 32, 32).data ?? new Uint8ClampedArray()
  let brightness = 0
  let warmth = 0
  for (let index = 0; index < pixels.length; index += 4) {
    brightness += (pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114)
    warmth += pixels[index] - pixels[index + 2]
  }
  const averageBrightness = brightness / (pixels.length / 4)
  const averageWarmth = warmth / (pixels.length / 4)
  const estimatedHour = Math.round(clamp(5.5 + averageBrightness / 255 * 3.5 + averageWarmth / 255 * 0.5, 5, 10) * 2) / 2
  const hours = Math.floor(estimatedHour)
  const minutes = estimatedHour % 1 ? '30' : '00'
  return `${String(hours).padStart(2, '0')}:${minutes}`
}

async function requestVisionAnalysis(image: string): Promise<Analysis> {
  const endpoint = import.meta.env.VITE_VISION_API_URL
  if (endpoint) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) })
    if (!response.ok) throw new Error('Vision service unavailable')
    return response.json()
  }

  // Local fallback keeps the demo usable without exposing a provider key. It only infers visual light and color cues.
  const imageElement = new Image()
  imageElement.src = image
  await new Promise<void>((resolve, reject) => { imageElement.onload = () => resolve(); imageElement.onerror = () => reject(new Error('Invalid image')) })
  const canvas = document.createElement('canvas')
  canvas.width = 1; canvas.height = 1
  const context = canvas.getContext('2d')
  context?.drawImage(imageElement, 0, 0, 1, 1)
  const [red, green, blue] = context?.getImageData(0, 0, 1, 1).data ?? [150, 180, 200]
  const brightness = (red + green + blue) / 3
  const blueBias = blue - red
  const cloudCover = Math.round(clamp(82 - brightness / 2 + (blueBias < 8 ? 12 : 0), 8, 96))
  const condition = cloudCover < 30 ? 'Sunny' : cloudCover < 65 ? 'Partly cloudy' : 'Cloudy'
  const icon = condition === 'Sunny' ? '☀️' : condition === 'Partly cloudy' ? '🌤️' : '☁️'
  const rainLikelihood = cloudCover > 72 ? 'Medium' : cloudCover > 48 ? 'Low' : 'Very low'
  const temperature = Math.round(18 + brightness / 8)
  return { condition, icon, cloudCover, rainLikelihood, temperatureEstimate: { value: temperature, unit: 'C', confidence: 'Low' }, humidityEstimate: cloudCover > 65 ? 'Elevated' : 'Moderate', visibilityEstimate: cloudCover > 75 ? 'Moderate' : 'High', confidence: Math.round(clamp(62 + Math.abs(50 - cloudCover) / 2, 62, 84)), visualEvidence: ['Overall scene brightness', 'Dominant sky color balance', `${cloudCover}% estimated cloud cover`], explanation: '' }
}

function App() {
  const [activeView, setActiveView] = useState<'report' | 'history'>('report')
  const [darkMode, setDarkMode] = useState(false)
  const [image, setImage] = useState('')
  const [fileName, setFileName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [imageTime, setImageTime] = useState('')
  const [imageTimeConfidence, setImageTimeConfidence] = useState('Waiting for an image')
  const [comparisonTime, setComparisonTime] = useState(currentTimeValue)
  const [currentTime, setCurrentTime] = useState(currentTimeValue)
  const [location, setLocation] = useState(defaultLocation)
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [actualWeather, setActualWeather] = useState<ActualWeather>(initialWeather)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>(() => JSON.parse(localStorage.getItem('morning-weather-history') || '[]'))
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { document.documentElement.dataset.theme = darkMode ? 'dark' : 'light' }, [darkMode])
  useEffect(() => { const timer = window.setInterval(() => setCurrentTime(currentTimeValue()), 30000); return () => window.clearInterval(timer) }, [])
  const readImage = (file?: File) => { if (!file) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Please choose a JPG, PNG, or WEBP image.'); return }; setError(''); setFileName(file.name); const reader = new FileReader(); reader.onload = async () => { const imageData = String(reader.result); setImage(imageData); setImageTimeConfidence('Estimating from light and color...'); try { setImageTime(await estimatePhotoTime(imageData)); setImageTimeConfidence('Visual estimate · low confidence') } catch { setImageTime(''); setImageTimeConfidence('Could not estimate time') } }; reader.readAsDataURL(file) }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); readImage(event.dataTransfer.files[0]) }
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => readImage(event.target.files?.[0])
  const useLocation = () => { if (!navigator.geolocation) { setError('Location services are unavailable. Enter a city manually.'); return }; navigator.geolocation.getCurrentPosition(({ coords }) => { setCoordinates({ latitude: coords.latitude, longitude: coords.longitude }); setLocation(`${coords.latitude.toFixed(3)}°, ${coords.longitude.toFixed(3)}°`) }, () => setError('Location permission was not granted. Enter a city manually.')) }
  const analyze = async () => {
    if (!image) { setError('Upload a morning image before analyzing.'); return }
    if (!imageTime) { setError('Enter the approximate time shown or captured in the photo.'); return }
    if (!location.trim()) { setError('Add a location so the actual weather can be compared.'); return }
    setError(''); setIsAnalyzing(true); setComparisonTime(currentTimeValue())
    try {
      let latitude = coordinates?.latitude
      let longitude = coordinates?.longitude
      if (!latitude || !longitude) {
        const placeResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`)
        const place = await placeResponse.json()
        const result = place.results?.[0]
        if (!result) throw new Error('Location not found')
        latitude = result.latitude
        longitude = result.longitude
      }
      const today = new Date().toISOString().slice(0, 10)
      const isToday = date === today
      const weatherUrl = isToday
        ? `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,cloud_cover,visibility,precipitation,wind_speed_10m&daily=sunrise,sunset&timezone=auto`
        : `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${date}&end_date=${date}&hourly=temperature_2m,relative_humidity_2m,weather_code,cloud_cover,visibility,precipitation,wind_speed_10m&daily=sunrise,sunset&timezone=auto`
      const weatherResponse = await fetch(weatherUrl)
      const weather = await weatherResponse.json()
      const current = weather.current ?? Object.fromEntries(Object.entries(weather.hourly ?? {}).map(([key, value]) => [key, (value as number[])[8] ?? 0]))
      const [condition, icon] = weatherLabel(current.weather_code)
      setActualWeather({ condition, icon, temperature: Math.round(current.temperature_2m), cloudCover: Math.round(current.cloud_cover ?? 0), humidity: Math.round(current.relative_humidity_2m ?? 0), visibility: Math.round((current.visibility ?? 0) / 1000 * 10) / 10, rain: Number((current.precipitation ?? 0).toFixed(1)), wind: Math.round(current.wind_speed_10m ?? 0), sunrise: weather.daily?.sunrise?.[0], sunset: weather.daily?.sunset?.[0] })
      setAnalysis(await requestVisionAnalysis(image))
    } catch { setError('We could not find live weather for that location. Check the city name and try again.') }
    finally { setIsAnalyzing(false) }
  }
  const timeMatch = clamp(100 - timeDifference(imageTime, comparisonTime) * 3, 0, 100)
  const score = useMemo(() => { if (!analysis || actualWeather.condition === 'Waiting') return 0; const condition = analysis.condition === actualWeather.condition ? 100 : analysis.condition === 'Partly cloudy' && actualWeather.condition === 'Cloudy' ? 72 : 38; const clouds = clamp(100 - Math.abs(analysis.cloudCover - actualWeather.cloudCover) * 2, 0, 100); const temperature = clamp(100 - Math.abs(analysis.temperatureEstimate.value - actualWeather.temperature) * 5, 0, 100); const rain = (analysis.rainLikelihood === 'Very low' || analysis.rainLikelihood === 'Low') === (actualWeather.rain < 0.5) ? 100 : 35; const visibility = analysis.visibilityEstimate === 'High' && actualWeather.visibility >= 8 ? 100 : 68; return Math.round(condition * .27 + clouds * .18 + temperature * .18 + rain * .18 + visibility * .09 + timeMatch * .1) }, [analysis, actualWeather, timeMatch])
  const scoreRows = analysis ? [['Weather condition', `${analysis.condition === actualWeather.condition ? 100 : 38}%`, 'full'], ['Cloud coverage', `${clamp(100 - Math.abs(analysis.cloudCover - actualWeather.cloudCover) * 2, 0, 100)}%`, 'near'], ['Temperature', `${clamp(100 - Math.abs(analysis.temperatureEstimate.value - actualWeather.temperature) * 5, 0, 100)}%`, 'near'], ['Rain prediction', `${(analysis.rainLikelihood === 'Very low' || analysis.rainLikelihood === 'Low') === (actualWeather.rain < 0.5) ? 100 : 35}%`, 'full'], ['Visibility', `${analysis.visibilityEstimate === 'High' && actualWeather.visibility >= 8 ? 100 : 68}%`, 'low'], ['Time of photo', `${timeMatch}%`, timeMatch >= 70 ? 'full' : 'low']] : []
  const saveReport = () => { if (!analysis || !image) return; const item = { id: Date.now(), date, location, image, ai: `${analysis.icon} ${analysis.condition}`, actual: `${actualWeather.icon} ${actualWeather.condition}`, score }; const next = [item, ...history.filter((entry) => entry.date !== date)].slice(0, 8); setHistory(next); localStorage.setItem('morning-weather-history', JSON.stringify(next)) }
  const resetReport = () => { setActiveView('report'); setImage(''); setFileName(''); setDate(new Date().toISOString().slice(0, 10)); setImageTime(''); setImageTimeConfidence('Waiting for an image'); setComparisonTime(currentTimeValue()); setLocation(defaultLocation); setCoordinates(null); setAnalysis(null); setActualWeather(initialWeather); setIsAnalyzing(false); setError('') }

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">☼</span><span>Morning Weather <b>Predictor</b></span></div><nav><button className={activeView === 'report' ? 'active' : ''} onClick={resetReport}>New report</button><button className="theme-toggle" aria-label="Toggle dark mode" onClick={() => setDarkMode(!darkMode)}>{darkMode ? '☀' : '◐'}</button></nav></header>
      {activeView === 'history' ? <main className="history-page"><div className="eyebrow">YOUR FIELD NOTES</div><h1>Prediction history</h1><p className="lede">A little archive of mornings you’ve checked.</p><div className="history-list">{history.length ? history.map((item) => <button className="history-item" key={item.id} onClick={() => { setImage(item.image); setDate(item.date); setLocation(item.location); setActiveView('report') }}><img src={item.image} alt="" /><span><strong>{new Date(`${item.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</strong><small>{item.location}</small></span><span className="history-weather">{item.ai} <i>→</i> {item.actual}</span><b className="history-score">{item.score}%</b></button>) : <div className="empty-state"><span>☁</span><strong>No saved mornings yet</strong><p>Your completed reports will appear here.</p></div>}</div></main> : <main><section className="hero-copy"><div><div className="eyebrow">A VISUAL WEATHER EXPERIMENT</div><h1>What does your<br /><em>morning look like?</em></h1><p>Upload a morning photo and we’ll read the sky, then compare that visual guess with what the weather actually did.</p></div><div className="sun-orbit"><span>☀</span><i></i><i></i></div></section>
        <section className="workspace"><div className="upload-column"><div className={`upload-box ${image ? 'has-image' : ''}`} onDrop={handleDrop} onDragOver={(event) => event.preventDefault()} onClick={() => fileInput.current?.click()}>{image ? <><img src={image} alt="Uploaded morning" /><div className="image-overlay"><span>Change photo</span><small>{fileName}</small></div></> : <><div className="upload-icon">↥</div><strong>Drop your morning photo here</strong><span>or click to browse</span><small>JPG, PNG, WEBP · up to 10 MB</small></>}<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} /></div><div className="details-row"><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Estimated photo time<input type="time" value={imageTime} readOnly placeholder="Upload an image" /><small className="time-confidence">{imageTimeConfidence}</small></label></div><div className="details-row location-row"><label>Location<div className="location-input"><input value={location} onChange={(event) => { setCoordinates(null); setLocation(event.target.value) }} placeholder="City, state, country" /><button type="button" onClick={useLocation} title="Use my location">⌖</button></div></label><div className="current-time"><span>Current time</span><strong>{currentTime}</strong><small>Compared when analyzed: {comparisonTime}</small></div></div>{error && <div className="error-message">! {error}</div>}<button className="primary-button" onClick={analyze} disabled={isAnalyzing}>{isAnalyzing ? <><span className="spinner"></span> Reading the sky...</> : <>Analyze this morning <span>↗</span></>}</button><p className="privacy-note">Your photo is used only for this analysis. Image-based predictions are visual estimates, not a forecast.</p></div>
          <div className="result-column">{isAnalyzing ? <div className="loading-card"><div className="loader-sky">☁</div><strong>Analyzing your<br />morning image...</strong><span>Looking for light, clouds, and clues</span><div className="loading-line"><i></i></div></div> : analysis ? <><div className="result-card ai-card"><div className="card-label">AI IMAGE PREDICTION <span>VISUAL ESTIMATE</span></div><div className="result-head"><span className="weather-icon">{analysis.icon}</span><div><small>It looks like a</small><h2>{analysis.condition} morning</h2></div><b>{analysis.confidence}%<small>confidence</small></b></div><div className="metric-grid"><div><small>Cloud cover</small><strong>{analysis.cloudCover}%</strong></div><div><small>Rain likelihood</small><strong>{analysis.rainLikelihood}</strong></div><div><small>Temperature</small><strong>{analysis.temperatureEstimate.value}°C<sup> estimate</sup></strong></div><div><small>Visibility</small><strong>{analysis.visibilityEstimate}</strong></div></div>{analysis.explanation && <p className="explanation">“{analysis.explanation}”</p>}</div><div className="result-card actual-card"><div className="card-label">ACTUAL WEATHER <span>OPEN-METEO · {date === new Date().toISOString().slice(0, 10) ? 'LIVE' : 'HISTORICAL'}</span></div><div className="result-head"><span className="weather-icon">{actualWeather.icon}</span><div><small>Recorded weather</small><h2>{actualWeather.condition} conditions</h2></div><b>100%<small>recorded</small></b></div><div className="metric-grid"><div><small>Cloud cover</small><strong>{actualWeather.cloudCover}%</strong></div><div><small>Rain likelihood</small><strong>{actualWeather.rain > 0 ? 'Observed' : 'None'}</strong></div><div><small>Temperature</small><strong>{actualWeather.temperature}°C</strong></div><div><small>Visibility</small><strong>{actualWeather.visibility} km</strong></div></div></div></> : <div className="empty-result"><span>✦</span><strong>Your weather story<br />will appear here</strong><p>Upload a photo to reveal the visual prediction and the real conditions side by side.</p></div>}</div></section>
        {analysis && <section className="comparison-section"><div className="section-title"><div><div className="eyebrow">THE MORNING CHECK</div><h2>Did your photo get it right?</h2></div><button className="save-button" onClick={saveReport}>＋ Save to history</button></div><div className="comparison-grid"><div className="match-card"><div className="match-score"><span>Prediction<br />match</span><strong>{score}<sup>%</sup></strong><small>visual similarity</small></div><div className="score-list">{scoreRows.map(([label, value, tone]) => <div className="score-row" key={label}><span>{label}</span><div className="progress"><i className={tone} style={{ width: value }}></i></div><b>{value}</b></div>)}</div></div><div className="verdict-card"><span className="verdict-icon">{score >= 70 ? '☀' : '☂'}</span><div><div className="eyebrow">{score >= 70 ? 'PRETTY ACCURATE' : 'NOT QUITE'}</div><h3>{score >= 70 ? 'The image read the morning well.' : 'The sky had a different story.'}</h3><p>The image predicted {analysis.condition.toLowerCase()} conditions, while the recorded weather was {actualWeather.condition.toLowerCase()}. This is a visual similarity check, not a scientific forecast score.</p></div></div></div><p className="score-disclaimer">This score measures similarity between an image-based inference and recorded weather data. It is not the accuracy of a scientific forecasting model.</p></section>}
      </main>}
      <footer><span>Morning Weather Predictor</span><span>Image estimates, real-world checks.</span></footer>
    </div>
  )
}

export default App
