# Use an official lightweight Python image
FROM python:3.11-slim

# Set environment variables to optimize Python execution in containers
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set the working directory inside the container
WORKDIR /app

# Copy dependency list first to leverage Docker cache
COPY requirements.txt .

# Install dependencies (including a production WSGI server like gunicorn)
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# [Bounty 10: Security & Compliance]
# Create a non-root user and switch to it. Running containers as root
# is a major security vulnerability.
RUN useradd -m appuser && chown -R appuser /app
USER appuser

# Expose the port the app runs on
EXPOSE 5000

# [Bounty 9: Scalability & Deployment]
# Use Gunicorn (a production-grade WSGI HTTP Server) instead of the
# built-in Flask development server, which cannot handle concurrent traffic.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "3", "main:app"]
