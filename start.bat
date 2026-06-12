@echo off
echo Starting AI Hackathon Servers in Mock Mode...

:: Start the backend API on port 8000
echo Starting Backend API (Port 8000)...
start cmd /k "cd backend && ..\venv\Scripts\activate && uvicorn main:app --reload"

:: Start the frontend server on port 8080
echo Starting Frontend UI (Port 8080)...
start cmd /k "cd frontend && python -m http.server 8080"

echo.
echo Both servers are starting in new windows!
echo - Backend API: http://127.0.0.1:8000/api/health
echo - Frontend UI: http://localhost:8080
echo.
echo To stop the servers, just close the new command prompt windows that popped up.
pause
