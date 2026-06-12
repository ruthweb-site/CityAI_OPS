# AI City Operations Agent 🏙️

An intelligent, AI-powered system designed to ingest, classify, and route citizen reports (like potholes, water leaks, and streetlights) using Microsoft Foundry and LLMs.

## 🚀 Features
- **AI Classification & Routing**: Automatically routes reports to the right department.
- **Priority Assessment**: Understands the urgency of issues (Low to CRITICAL) based on the citizen's description.
- **Duplicate Detection**: Identifies if a similar issue was recently reported at the same location.
- **Resolution Planning**: Generates step-by-step action plans for city workers to resolve the issue.

## 🏗️ Architecture

```mermaid
graph TD
    User["👤 Citizen User"] -->|HTTP POST (Report Issue)| Frontend["🖥️ Frontend UI (Vercel Static)"]
    Frontend -->|API Request (/api/reports)| Backend["⚙️ FastAPI Backend (Vercel Serverless)"]
    Backend -->|Submit Report| Agent["🧠 City Operations AI Agent"]
    
    subgraph AI Processing
        Agent -->|1. Check DB| DB[("🗄️ In-Memory DB")]
        DB -->|2. Return Exising| Agent
        Agent -->|3. Fallback (Mock Mode)| Mock["🔍 Local Mock Algorithm"]
        Agent -->|4. Production (Foundry)| Foundry["☁️ Azure AI Foundry SDK"]
        Foundry -->|LLM Prompt| Model["🤖 GPT-4o Model"]
        Model -->|JSON Response (Priority, Plan, Dept)| Foundry
        Foundry -->|Parsed Data| Agent
    end

    Agent -->|Save Result| DB
    Agent -->|Return Response| Backend
    Backend -->|Return JSON| Frontend
    Frontend -->|Display Resolution Plan| User
```

## 🛠️ Tech Stack
- **Backend**: Python, FastAPI
- **Frontend**: Vanilla JS, HTML, CSS
- **AI Integration**: Microsoft Azure AI Foundry (`gpt-4o`)

## 💻 Local Setup
1. Clone the repository.
2. Navigate to the project folder.
3. Run `start.bat` on Windows to launch both the frontend and backend servers automatically!
   - Frontend will run on `http://localhost:8080`
   - Backend API will run on `http://127.0.0.1:8000`

### (Optional) Configure Real AI
By default, the application runs in a completely free **Mock Mode**. If you want to connect to a real Azure AI model:
1. Log in to Azure (`az login`).
2. Create an `.env` file in the `backend/` folder.
3. Add your credentials:
```env
FOUNDRY_PROJECT_ENDPOINT=https://your-project.services.ai.azure.com/api/projects/my-project
FOUNDRY_MODEL_DEPLOYMENT_NAME=gpt-4o
```

## 🌐 Deployment
This project is configured to be seamlessly deployed on **Vercel** as a monorepo!
- The frontend is hosted as a static site.
- The backend FastAPI application is automatically converted to serverless functions via `@vercel/python`.
