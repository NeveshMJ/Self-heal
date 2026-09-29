# Self-Heal Controller Backend

FastAPI + PostgreSQL REST API for the React/Vite Self-Heal Controller.

## Requirements
- Python 3.11+
- PostgreSQL 14+

## Setup

1. Create a PostgreSQL database:
   `CREATE DATABASE self_heal;`

2. Copy `.env.example` to `.env` and set `DATABASE_URL`.

3. Install:
   `python -m venv .venv`
   - Windows: `.venv\Scripts\activate`
   - Linux/macOS: `source .venv/bin/activate`
   `pip install -r requirements.txt`

4. Start:
   `uvicorn app.main:app --reload`

API docs:
- http://localhost:8000/docs
- http://localhost:8000/redoc

The application creates the requested tables automatically on startup for this MVP.

## Roles
- admin: dashboard, tickets, insights, dataset upload, retention, audit logs
- analyst: dashboard, tickets, insights, self-heal, override, escalation
- viewer: dashboard and insights

## Important
JWT authentication is enforced server-side. Passwords are hashed; they are never stored as plaintext.
