"use client";

import React, { useEffect, useRef, useState } from 'react';
import h337 from 'heatmap.js';
import JSZip from 'jszip';
import Image from 'next/image'; // Import Next.js Image component

// Add these interfaces at the top of your file, before the component.

// For webgazer
declare global {
  interface Window {
    webgazer: {
      setGazeListener: (callback: (data: { x: number; y: number; }, elapsedTime: number) => void) => Window['webgazer'];
      setRegression: (type: string) => Window['webgazer'];
      begin: () => Promise<void>;
      showVideoPreview: (show: boolean) => Window['webgazer'];
      showPredictionPoints: (show: boolean) => Window['webgazer'];
      applyKalmanFilter: (apply: boolean) => Window['webgazer'];
      end: () => void;
      clearData: () => void;
      resume: () => void;
      pause: () => void;
      getCurrentPrediction: () => { x: number; y: number; } | null; // Added based on common usage
      // You might need to add more properties/methods if you use them and they are not listed
    };
  }
}

// For heatmap.js (h337)
interface HeatmapConfiguration {
  container: HTMLElement;
  radius?: number;
  maxOpacity?: number;
  minOpacity?: number;
  blur?: number;
}

interface HeatmapPoint {
  x: number;
  y: number;
  value: number;
}

interface HeatmapData {
  max: number;
  data: HeatmapPoint[];
}

interface HeatmapInstance {
  setData: (data: HeatmapData) => void;
  // Add other methods if you use them, e.g., addData, _renderer, etc.
}

interface H337Lib { // Renamed from H337 to avoid conflict with imported var
  create: (config: HeatmapConfiguration) => HeatmapInstance;
}

// Define the type for gaze data
interface GazeData {
  x: number;
  y: number;
  timestamp: number;
  offScreen: boolean;
  snapshot: string | null;
  snapshotFilename: string | null;
  eventTime: Date;
}

// Define the type for calibration points
interface CalibrationPoint {
  x: string;
  y: string;
  status: 'active' | 'inactive' | 'clicked';
}


const WebGazerAntiCheating: React.FC = () => {
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [offScreenEvents, setOffScreenEvents] = useState<number>(0);
  const [allGazeData, setAllGazeData] = useState<GazeData[]>([]);
  const [webgazerReady, setWebgazerReady] = useState<boolean>(false);
  const [calibrationPoints, setCalibrationPoints] = useState<CalibrationPoint[]>([]);
  const [currentCalibrationPointIndex, setCurrentCalibrationPointIndex] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(true);
  const [modalInstructionsText, setModalInstructionsText] = useState<string>('Please allow webcam access. Then, click the 9 dots that will appear on the screen to calibrate the eye tracker. Look at each dot as you click it.');
  const [calibrationStatusText, setCalibrationStatusText] = useState<string>('Waiting for webcam...');
  // Removed setClmConvergence as it's not used. clmConvergence is now a static const.
  const clmConvergence = '-';
  const [isExamStarted, setIsExamStarted] = useState<boolean>(false);
  const [showReport, setShowReport] = useState<boolean>(false);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);

  const heatmapInstanceRef = useRef<HeatmapInstance | null>(null);
  const gazeDotRef = useRef<HTMLDivElement>(null);
  const heatmapContainerRef = useRef<HTMLDivElement>(null);
  const offScreenLogRef = useRef<HTMLUListElement>(null);
  const snapshotFileCounter = useRef<number>(0);

  const isTrackingRef = useRef(isTracking);
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  const TOTAL_CALIBRATION_POINTS = 9;

  useEffect(() => {
    const initializeWebGazer = async () => {
      if (typeof window.webgazer === 'undefined') {
        setCalibrationStatusText('Error: WebGazer.js failed to load.');
        setModalInstructionsText(`WebGazer.js is missing or failed to load. Please ensure the library is correctly linked.`);
        return;
      }

      // Type assertion for h337
      const typedH337 = h337 as unknown as H337Lib;

      if (typeof typedH337 !== 'undefined' && heatmapContainerRef.current) {
        heatmapInstanceRef.current = typedH337.create({
          container: heatmapContainerRef.current,
          radius: 35,
          maxOpacity: 0.7,
          minOpacity: 0.05,
          blur: 0.85,
        });
      }

      try {
        window.webgazer.setGazeListener(gazeListener);
        await window.webgazer.setRegression('ridge').begin();
        window.webgazer.showVideoPreview(true).showPredictionPoints(true).applyKalmanFilter(true);
        setWebgazerReady(true);
        setCalibrationStatusText('Webcam ready.');
        setModalInstructionsText('Please allow webcam access. Then click "Start 9-Point Calibration". Look at each dot as you click it.');
      } catch (err) {
        console.error("WebGazer initialization failed:", err);
        setCalibrationStatusText('Error: Could not start webcam.');
        setModalInstructionsText('Webcam access failed. Please check permissions and ensure no other application is using the webcam.');
      }
    };

    const script = document.createElement('script');
    script.src = 'https://webgazer.cs.brown.edu/webgazer.js';
    script.async = true;
    script.onload = () => {
        console.log("WebGazer script loaded successfully!");
        initializeWebGazer();
    };
    script.onerror = () => {
        console.error("Failed to load WebGazer script.");
        setCalibrationStatusText('Error: WebGazer.js script failed to download.');
    };

    document.body.appendChild(script);

    return () => {
      if (window.webgazer) {
        window.webgazer.end();
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  const gazeListener = (data: { x: number; y: number; }, elapsedTime: number) => {
    if (!data || !isTrackingRef.current) {
        if (gazeDotRef.current) gazeDotRef.current.style.display = 'none';
        return;
    };

    const x = Math.round(data.x);
    const y = Math.round(data.y);

    if (gazeDotRef.current) {
      gazeDotRef.current.style.left = `${x - gazeDotRef.current.offsetWidth / 2}px`;
      gazeDotRef.current.style.top = `${y - gazeDotRef.current.offsetHeight / 2}px`;
      gazeDotRef.current.style.display = 'block';
    }

    const isOffScreen = x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight; // Changed to const
    let snapshotDataUrl: string | null = null;

    if (isOffScreen) {
      setOffScreenEvents(prev => prev + 1);
      const videoElement = document.getElementById('webgazerVideoFeed') as HTMLVideoElement;
      if (videoElement) {
          const snapshotCanvas = document.createElement('canvas');
          snapshotCanvas.width = videoElement.videoWidth / 5;
          snapshotCanvas.height = videoElement.videoHeight / 5;
          const snapshotContext = snapshotCanvas.getContext('2d');
          if (snapshotContext) { // Check if context is not null
            snapshotContext.drawImage(videoElement, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
            snapshotDataUrl = snapshotCanvas.toDataURL('image/jpeg', 0.5);
          }
      }
    }

    setAllGazeData(prev => [
      ...prev,
      {
        x, y, timestamp: elapsedTime, offScreen: isOffScreen,
        snapshot: snapshotDataUrl,
        snapshotFilename: isOffScreen && snapshotDataUrl ? `snapshot_${++snapshotFileCounter.current}.jpg` : null,
        eventTime: new Date(),
      },
    ]);
  };


  useEffect(() => {
    if (showHeatmap && heatmapInstanceRef.current && allGazeData.length > 0) {
        console.log("Rendering heatmap with data points:", allGazeData.length);
        const pointsForDisplay = allGazeData
            .filter(p => !p.offScreen)
            .map(p => ({ x: Math.round(p.x), y: Math.round(p.y), value: 10 }));

        if (pointsForDisplay.length > 0) {
            heatmapInstanceRef.current.setData({ max: 100, data: pointsForDisplay });
        }
    }
  }, [showHeatmap, allGazeData]);

  const handleStartCalibration = () => {
    const points: CalibrationPoint[] = [ // Explicitly type points
      { x: '5%', y: '5%', status: 'inactive' }, { x: '50%', y: '5%', status: 'inactive' }, { x: '95%', y: '5%', status: 'inactive' },
      { x: '5%', y: '50%', status: 'inactive' }, { x: '50%', y: '50%', status: 'inactive' }, { x: '95%', y: '50%', status: 'inactive' },
      { x: '5%', y: '95%', status: 'inactive' }, { x: '50%', y: '95%', status: 'inactive' }, { x: '95%', y: '95%', status: 'inactive' },
    ];
    setCalibrationPoints(points.map((p, index) => ({ ...p, status: index === 0 ? 'active' : 'inactive' })));
    setCurrentCalibrationPointIndex(0);
    setModalInstructionsText(`Click the RED dot (1 of ${TOTAL_CALIBRATION_POINTS}).`);
    if (webgazerReady) window.webgazer.showPredictionPoints(true);
  };

  const handleCalibrationClick = (index: number) => {
    if (index !== currentCalibrationPointIndex) return;
    const newPoints = [...calibrationPoints];
    newPoints[index].status = 'clicked';
    if (index + 1 < TOTAL_CALIBRATION_POINTS) {
      newPoints[index + 1].status = 'active';
      setModalInstructionsText(`Click the RED dot (${index + 2} of ${TOTAL_CALIBRATION_POINTS}).`);
    }
    setCalibrationPoints(newPoints);
    setCurrentCalibrationPointIndex(index + 1);

    if (index + 1 === TOTAL_CALIBRATION_POINTS) {
      finishCalibration();
    }
  };

  const finishCalibration = () => {
    setCalibrationPoints([]);
    setModalInstructionsText('Calibration Complete! You can now start the exam.');
    setCalibrationStatusText('Calibration Complete!');
    if (webgazerReady) window.webgazer.showPredictionPoints(false);
  };

  const handleStartExam = () => {
    console.log("Starting exam, setting isTracking to true.");
    setIsTracking(true);
    setIsExamStarted(true);
    setShowReport(false);
    setShowHeatmap(false);
    setAllGazeData([]);
    setOffScreenEvents(0);
    snapshotFileCounter.current = 0;
    if (heatmapInstanceRef.current) {
        heatmapInstanceRef.current.setData({ max: 1, data: [] });
    }
    if (webgazerReady) window.webgazer.resume();
  };

  const handleStopExam = () => {
    console.log("Stopping exam, setting isTracking to false.");
    setIsTracking(false);
    if (webgazerReady) window.webgazer.pause();
    setShowReport(true);
    setShowHeatmap(true);
  };

  const handleRecalibrate = () => {
    if (webgazerReady) window.webgazer.clearData();
    setIsModalOpen(true);
    setShowReport(false);
    setShowHeatmap(false);
    setIsExamStarted(false);
    setAllGazeData([]);
    setOffScreenEvents(0);
    snapshotFileCounter.current = 0;
    setCalibrationStatusText('Webcam ready.');
    setModalInstructionsText('Please allow webcam access. Then click "Start 9-Point Calibration".');
  };

  const generateAndDownloadZipReport = async () => {
    const zip = new JSZip();

    let reportContent = `Exam Report\nTotal Off-Screen Events: ${offScreenEvents}\n\n`;
    allGazeData.filter(e => e.offScreen).forEach((event, index) => {
        let eventDetail = `${index + 1}. Time: ${event.eventTime.toLocaleTimeString()}, Coords: (${event.x}, ${event.y})`;
        if (event.snapshotFilename) {
            eventDetail += ` (Snapshot: ${event.snapshotFilename})`;
        }
        reportContent += eventDetail + '\n';
    });
    zip.file("report.txt", reportContent);

    const imgFolder = zip.folder("snapshots");
    allGazeData.filter(e => e.snapshot).forEach(event => {
        const base64Data = event.snapshot!.split(',')[1]; // Use non-null assertion as filter already checks for snapshot
        if (imgFolder && event.snapshotFilename) {
            imgFolder.file(event.snapshotFilename, base64Data, { base64: true });
        }
    });

    if (allGazeData.length > 0) {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const margin = 300;
        const extendedCanvasWidth = screenWidth + 2 * margin;
        const extendedCanvasHeight = screenHeight + 2 * margin;

        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-99999px';
        tempContainer.style.top = '-99999px';
        tempContainer.style.width = `${extendedCanvasWidth}px`;
        tempContainer.style.height = `${extendedCanvasHeight}px`;
        document.body.appendChild(tempContainer);

        try {
            const tempHeatmapInstance = (h337 as unknown as H337Lib).create({ // Type assertion here
                container: tempContainer,
                radius: 35,
            });

            const reportGazePoints = allGazeData.map((p) => ({
                x: Math.round(p.x) + margin,
                y: Math.round(p.y) + margin,
                value: 10,
            }));

            tempHeatmapInstance.setData({ max: 100, data: reportGazePoints });

            await new Promise(resolve => setTimeout(resolve, 100));

            const reportCanvas = tempContainer.querySelector('canvas');
            if (reportCanvas) {
                const ctx = reportCanvas.getContext('2d');
                if (ctx) {
                    ctx.strokeStyle = 'rgba(100, 100, 100, 0.8)';
                    ctx.lineWidth = 3;
                    ctx.setLineDash([10, 5]);
                    ctx.strokeRect(margin, margin, screenWidth, screenHeight);
                    ctx.setLineDash([]);
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    ctx.font = '16px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('Screen Area', margin + screenWidth / 2, margin + 20);
                }

                const dataURL = reportCanvas.toDataURL('image/png');
                const heatmapBase64 = dataURL.split(',')[1]; // Correct variable name
                if (heatmapBase64) { // Added check for robustness
                    zip.file("heatmap_with_screen_outline.png", heatmapBase64, { base64: true });
                }
            }
        } catch (error) {
            console.error("Error generating heatmap for report:", error);
        } finally {
            document.body.removeChild(tempContainer);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = "exam_report.zip";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="text-slate-700 font-sans bg-gray-100 min-h-screen">
      <div ref={gazeDotRef} style={{ display: 'none', position: 'fixed', width: '15px', height: '15px', backgroundColor: 'rgba(255, 0, 0, 0.7)', borderRadius: '50%', zIndex: 10002, pointerEvents: 'none', border: '1px solid white', boxShadow: '0 0 5px black' }}></div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-xl text-center max-w-md w-full">
            <h2 className="text-2xl font-bold mb-4">Calibration</h2>
            <p className="mb-4 text-slate-600">{modalInstructionsText}</p>
            <p className="mb-2 text-slate-600">Calibration Status: {calibrationStatusText}</p>
            <div className="flex justify-center space-x-2 mb-4">
              {[...Array(TOTAL_CALIBRATION_POINTS)].map((_, i) => (
                <span key={i} className={`h-2.5 w-2.5 rounded-full ${calibrationPoints[i]?.status === 'active' ? 'bg-yellow-400' : calibrationPoints[i]?.status === 'clicked' ? 'bg-green-500' : 'bg-gray-300'}`}></span>
              ))}
            </div>
            {/* If clmConvergence is always '-', consider removing the state and just hardcoding the text */}
            <p className="mb-2 text-slate-600">CLM Convergence: {clmConvergence}</p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 mt-6">
              <button onClick={handleStartCalibration} disabled={!webgazerReady} className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg shadow-md disabled:bg-gray-400">
                Start 9-Point Calibration
              </button>
              <button onClick={() => setIsModalOpen(false)} disabled={currentCalibrationPointIndex < TOTAL_CALIBRATION_POINTS} className="bg-slate-500 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg shadow-md disabled:bg-gray-400">
                Close & Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {calibrationPoints.map((point, index) => (
        <div
          key={index}
          className={`absolute w-5 h-5 rounded-full cursor-pointer transition-all ${point.status === 'active' ? 'bg-red-500 scale-125' : point.status === 'clicked' ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ left: point.x, top: point.y, zIndex: 10001 }}
          onClick={() => handleCalibrationClick(index)}
        ></div>
      ))}

      <div className="container mx-auto p-8 space-y-8">
        <h1 className="text-4xl font-bold text-center text-slate-700">Anti-Cheating Eye Tracking</h1>
        <div className="flex justify-center">
            <div className="bg-white p-6 rounded-xl shadow-xl w-full sm:w-auto">
                <h2 className="text-xl font-semibold mb-4 text-slate-600">Controls</h2>
                <div className="flex flex-wrap gap-3">
                    <button onClick={handleStartExam} disabled={isExamStarted || !webgazerReady || currentCalibrationPointIndex < TOTAL_CALIBRATION_POINTS} className="flex-grow bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-5 rounded-lg shadow-md disabled:bg-gray-400">
                        Start Exam
                    </button>
                    <button onClick={handleStopExam} disabled={!isExamStarted} className="flex-grow bg-red-500 hover:bg-red-600 text-white font-medium py-2 px-5 rounded-lg shadow-md disabled:bg-gray-400">
                        Stop Exam & Report
                    </button>
                    <button onClick={handleRecalibrate} className="flex-grow bg-yellow-500 hover:bg-yellow-600 text-black font-medium py-2 px-5 rounded-lg shadow-md">
                        Recalibrate
                    </button>
                    {showReport && (
                        <button onClick={generateAndDownloadZipReport} className="flex-grow bg-teal-500 hover:bg-teal-600 text-white font-medium py-2 px-5 rounded-lg shadow-md">
                            Download Report (ZIP)
                        </button>
                    )}
                </div>
            </div>
        </div>

        <div className="bg-white p-8 rounded-xl shadow-xl min-h-[300px]">
          <h3 className="text-xl font-semibold mb-3">Exam Content Area</h3>
          <p className="text-slate-500">This is where the exam questions or task would appear.</p>
        </div>

        {showReport && (
          <div className="bg-white p-8 rounded-xl shadow-xl">
            <h2 className="text-2xl font-semibold mb-6">Exam Report</h2>
            <div>
              <h3 className="text-xl font-semibold mb-3">Off-Screen Gaze Events:</h3>
              <p className="mb-3">Count: {offScreenEvents}</p>
              <ul ref={offScreenLogRef} className="list-disc list-inside max-h-72 overflow-y-auto space-y-3 border p-4 rounded-md">
                {allGazeData.filter(e => e.offScreen).map((event, index) => (
                  <li key={index} className="flex items-center">
                    {`Off-screen gaze at ${event.eventTime.toLocaleTimeString()} (x: ${event.x}, y: ${event.y})`}
                    {event.snapshot && (
                      <Image
                        src={event.snapshot}
                        alt="snapshot"
                        width={80} // Corresponds to w-20
                        height={64} // Corresponds to h-16
                        className="object-cover border ml-4 rounded"
                        unoptimized // Required for data URLs
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <h3 className="text-xl font-semibold my-3">Gaze Heatmap:</h3>
             <div className="bg-slate-100 h-64 rounded-md flex items-center justify-center text-slate-400">
                Heatmap is shown as a full-screen overlay.
             </div>
          </div>
        )}
      </div>

      <div style={{ display: showHeatmap ? 'block' : 'none', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9000, pointerEvents: 'none' }}>
        <div ref={heatmapContainerRef} className="w-full h-full"></div>
      </div>
    </div>
  );
};

export default WebGazerAntiCheating;