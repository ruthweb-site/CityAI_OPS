import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from agent import CityOperationsAgent

app = FastAPI(title="AI City Operations Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

city_agent = CityOperationsAgent()

class ReportRequest(BaseModel):
    description: str
    location: str
    name: Optional[str] = "Anonymous"

class StatusUpdate(BaseModel):
    status: str

# In-memory DB
db_reports = []

@app.post("/api/reports")
async def submit_report(request: ReportRequest):
    try:
        duplicate_check = city_agent.detect_duplicate(request.description, request.location, db_reports)
        if duplicate_check.get("is_duplicate"):
            return {
                "is_duplicate": True,
                "parent_id": duplicate_check.get("parent_id")
            }

        analysis = city_agent.analyze_report(request.description)
        
        if analysis.get("needs_info"):
            return {
                "needs_info": True,
                "follow_up_question": analysis.get("follow_up_question")
            }
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
            "processing_time_ms": analysis.get("processing_time_ms", 0),
            "status": "New"
        }
        db_reports.append(report)
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
            return report
    raise HTTPException(status_code=404, detail="Report not found")

@app.get("/api/insights")
async def get_insights():
    try:
        insights = city_agent.generate_insights(db_reports)
        return insights
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "mode": "mock" if city_agent.use_mock else "foundry"}
