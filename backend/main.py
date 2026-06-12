import os
import json
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from agent import CityOperationsAgent

app = FastAPI(title="AI City Operations Agent API — Multi-Agent + Foundry IQ")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

city_agent = CityOperationsAgent()

# ─────────────────────────────────────────────────────────────
#  WEBSOCKET CONNECTION MANAGER
# ─────────────────────────────────────────────────────────────
class ConnectionManager:
    """Manages all active WebSocket connections for real-time broadcast."""
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, event_type: str, data: dict):
        """Broadcast a typed event to all connected clients."""
        message = json.dumps({"type": event_type, "payload": data})
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                dead_connections.append(connection)
        for conn in dead_connections:
            self.disconnect(conn)

manager = ConnectionManager()

# ─────────────────────────────────────────────────────────────
#  MODELS & IN-MEMORY DB
# ─────────────────────────────────────────────────────────────
class ReportRequest(BaseModel):
    description: str
    location: str
    name: Optional[str] = "Anonymous"

class StatusUpdate(BaseModel):
    status: str

db_reports = []

# ─────────────────────────────────────────────────────────────
#  WEBSOCKET ENDPOINT
# ─────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send current state to the newly connected client
        await websocket.send_text(json.dumps({
            "type": "init",
            "payload": {"reports": db_reports, "total": len(db_reports)}
        }))
        # Keep connection alive, listening for client pings
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ─────────────────────────────────────────────────────────────
#  REST ENDPOINTS
# ─────────────────────────────────────────────────────────────
@app.post("/api/reports")
async def submit_report(request: ReportRequest):
    try:
        # Duplicate detection
        duplicate_check = city_agent.detect_duplicate(
            request.description, request.location, db_reports
        )
        if duplicate_check.get("is_duplicate"):
            return {"is_duplicate": True, "parent_id": duplicate_check.get("parent_id")}

        # Run full multi-agent pipeline
        analysis = city_agent.analyze_report(request.description)

        if analysis.get("needs_info"):
            return {"needs_info": True, "follow_up_question": analysis.get("follow_up_question")}

        report = {
            "id": f"REP-{len(db_reports) + 1:04d}",
            "name": request.name,
            "description": request.description,
            "location": request.location,
            "department": analysis.get("department", "City Services"),
            "priority": analysis.get("priority", "Medium"),
            "classification": analysis.get("classification", "General Issue"),
            "confidence": analysis.get("confidence", 80),
            "reasoning": analysis.get("reasoning", ""),
            "reasoning_steps": analysis.get("reasoning_steps", []),
            "resolution_plan": analysis.get("resolution_plan", []),
            "policy_citation": analysis.get("policy_citation", ""),
            "resource_allocation": analysis.get("resource_allocation", {}),
            "processing_time_ms": analysis.get("processing_time_ms", 0),
            "status": "New",
        }
        db_reports.append(report)

        # 🔴 Broadcast new report to ALL connected WebSocket clients in real-time
        await manager.broadcast("new_report", report)

        return report

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/reports")
async def get_reports():
    return {"reports": db_reports, "total": len(db_reports)}

@app.patch("/api/reports/{report_id}/status")
async def update_status(report_id: str, update: StatusUpdate):
    for report in db_reports:
        if report["id"] == report_id:
            report["status"] = update.status
            # Broadcast status change to all connected clients
            await manager.broadcast("status_update", {"id": report_id, "status": update.status})
            return report
    raise HTTPException(status_code=404, detail="Report not found")

@app.get("/api/insights")
async def get_insights():
    try:
        return city_agent.generate_insights(db_reports)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
async def health_check():
    mode = "mock" if city_agent.use_mock else "foundry"
    return {
        "status": "healthy",
        "mode": mode,
        "foundry_iq": "active",
        "ws_connections": len(manager.active_connections),
        "reports_in_memory": len(db_reports)
    }
