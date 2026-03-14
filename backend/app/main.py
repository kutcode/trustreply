"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import upload, qa, flagged
from app.services.parser import get_parser_profiles


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # Startup: create database tables
    await init_db()
    yield
    # Shutdown: nothing to clean up


app = FastAPI(
    title="TrustReply",
    description="TrustReply auto-fills questionnaire documents using a Q&A knowledge base with semantic matching.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(upload.router)
app.include_router(qa.router)
app.include_router(flagged.router)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "1.0.0"}


@app.get("/api/settings")
async def get_settings():
    """Get current application settings."""
    return {
        "similarity_threshold": settings.similarity_threshold,
        "embedding_model": settings.embedding_model,
        "default_parser_profile": settings.default_parser_profile,
        "max_bulk_files": settings.max_bulk_files,
        "parser_profiles": get_parser_profiles(),
    }
