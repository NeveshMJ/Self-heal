import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.bootstrap import migrate, seed_defaults
from app.core.config import settings
from app.core.middleware import (BodySizeLimitMiddleware, JWTAuthMiddleware,
                                 SecurityHeadersMiddleware)
from app.db.session import Base, engine
from app.models import models  # noqa: F401  (registers models)
from app.routers import (admin, articles, auth, dashboard, departments,
                         insights, tickets)
from app.services import question_gen
from app.services.matcher import matcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    # create tables, then load the matcher (model + embeddings) once
    Base.metadata.create_all(bind=engine)
    # add any new columns to an existing database, then make sure the fixed
    # logins (admin/admin@123, analyst/analyst@123) and departments exist
    migrate()
    seed_defaults()
    try:
        matcher.load()
        print(f"Matcher loaded: {sum(len(v['ids']) for v in matcher.by_dept.values())} article sentences.")
    except Exception as e:
        # API still starts; matching will error clearly until data + embeddings exist
        print(f"WARNING: matcher not loaded yet ({e}). Run the loader + embed step.")

    # warm up the Ask More T5 in the background so the first click is fast.
    # The libraries are imported here on the main thread first: transformers'
    # lazy imports break when two threads import it at the same time.
    if settings.t5_enabled:
        try:
            question_gen.import_libraries()
            threading.Thread(target=question_gen._load, daemon=True).start()
        except Exception as e:
            print(f"WARNING: Ask More T5 libraries unavailable ({e}); using templates.")
    yield


app = FastAPI(
    title="Self-Heal Controller API",
    version="1.0.0",
    description="REST API for the Self-Heal Controller React application.",
    lifespan=lifespan,
)

# Middleware order: the LAST one added runs first. So the chain a request
# travels is  CORS -> body size -> JWT -> security headers -> route.
app.add_middleware(SecurityHeadersMiddleware, hsts=settings.enable_hsts)
app.add_middleware(JWTAuthMiddleware)
app.add_middleware(BodySizeLimitMiddleware)

origins = [x.strip() for x in settings.cors_origins.split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(departments.router)
app.include_router(articles.router)
app.include_router(tickets.router)
app.include_router(dashboard.router)
app.include_router(insights.router)
app.include_router(admin.router)


@app.get("/")
def root():
    return {"name": "Self-Heal Controller API", "status": "ok"}


@app.get("/health")
def health():
    return {"status": "healthy"}
