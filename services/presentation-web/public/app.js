const serviceGrid = document.querySelector('#service-grid');
const systemStatus = document.querySelector('#system-status');
const runtimeGeneratedAt = document.querySelector('#runtime-generated-at');
const heroStatus = document.querySelector('#hero-status');

function formatTimestamp(value) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderServices(snapshot) {
  if (!serviceGrid) {
    return;
  }

  serviceGrid.innerHTML = snapshot.services
    .map((service) => {
      const livenessClass = service.liveness === 'up' ? 'pill-up' : 'pill-down';
      const readinessClass = service.readiness === 'up' ? 'pill-up' : 'pill-down';
      const detail = JSON.stringify(service.details, null, 2);

      return `
        <article class="service-card card">
          <div class="service-card-header">
            <div>
              <p class="eyebrow">${service.kind}</p>
              <h4>${service.name}</h4>
            </div>
            <span class="service-url">${service.url}</span>
          </div>
          <div class="pill-row">
            <span class="status-chip ${livenessClass}">Liveness: ${service.liveness}</span>
            <span class="status-chip ${readinessClass}">Readiness: ${service.readiness}</span>
          </div>
          <pre class="service-detail"><code>${escapeHtml(detail)}</code></pre>
        </article>
      `;
    })
    .join('');
}

function updateSummary(snapshot) {
  if (systemStatus) {
    systemStatus.textContent = snapshot.system_status === 'healthy' ? 'Healthy' : 'Degraded';
  }

  if (runtimeGeneratedAt) {
    runtimeGeneratedAt.textContent = `Last refreshed ${formatTimestamp(snapshot.generated_at)}`;
  }

  if (heroStatus) {
    heroStatus.textContent =
      snapshot.system_status === 'healthy' ? 'Runtime healthy' : 'Runtime needs attention';
    heroStatus.classList.toggle('status-pill-alert', snapshot.system_status !== 'healthy');
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function refreshRuntime() {
  try {
    const response = await fetch('/api/runtime');
    if (!response.ok) {
      throw new Error(`runtime request failed with status ${response.status}`);
    }

    const snapshot = await response.json();
    updateSummary(snapshot);
    renderServices(snapshot);
  } catch (error) {
    if (systemStatus) {
      systemStatus.textContent = 'Unavailable';
    }

    if (runtimeGeneratedAt) {
      runtimeGeneratedAt.textContent =
        error instanceof Error ? error.message : 'Failed to load runtime snapshot';
    }
  }
}

await refreshRuntime();
window.setInterval(refreshRuntime, 8000);
