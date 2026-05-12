(() => {
  "use strict";

  const STORAGE_KEY = "gps-marker-locations";

  // --- State ---
  let map;
  let currentPosMarker = null;
  let currentAccuracyCircle = null;
  let markers = [];
  let locations = loadLocations();

  // --- DOM refs ---
  const btnLocate = document.getElementById("btn-locate");
  const btnMark = document.getElementById("btn-mark");
  const crosshair = document.getElementById("crosshair");
  const btnList = document.getElementById("btn-list");
  const btnExport = document.getElementById("btn-export");
  const statusBar = document.getElementById("status-bar");
  const panel = document.getElementById("panel");
  const btnClosePanel = document.getElementById("btn-close-panel");
  const locationList = document.getElementById("location-list");
  const emptyMsg = document.getElementById("empty-msg");
  const btnClearAll = document.getElementById("btn-clear-all");
  const btnExportPanel = document.getElementById("btn-export-panel");

  // --- Init map ---
  function initMap() {
    map = L.map("map", {
      zoomControl: false,
    }).setView([25.0, 45.0], 3);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    // Show crosshair coords as user pans
    map.on("move", () => {
      const c = map.getCenter();
      setStatus(`${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`);
    });

    // Render any saved locations
    locations.forEach((loc) => addMarkerToMap(loc));
  }

  // --- Geolocation ---
  function locateUser() {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation not supported by your browser");
      return;
    }

    btnLocate.classList.add("locating");
    setStatus("Getting your location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        if (currentPosMarker) {
          currentPosMarker.setLatLng([latitude, longitude]);
          currentAccuracyCircle.setLatLng([latitude, longitude]);
          currentAccuracyCircle.setRadius(accuracy);
        } else {
          const icon = L.divIcon({
            className: "current-pos-marker",
            iconSize: [16, 16],
          });
          currentPosMarker = L.marker([latitude, longitude], { icon }).addTo(map);
          currentAccuracyCircle = L.circle([latitude, longitude], {
            radius: accuracy,
            color: "#0096ff",
            fillColor: "#0096ff",
            fillOpacity: 0.08,
            weight: 1,
          }).addTo(map);
        }

        map.flyTo([latitude, longitude], 16, { duration: 1 });
        btnLocate.classList.remove("locating");
      },
      (err) => {
        btnLocate.classList.remove("locating");
        const messages = {
          1: "Location permission denied.",
          2: "Position unavailable.",
          3: "Location request timed out.",
        };
        setStatus(messages[err.code] || "Could not get location");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // --- Mark location (drop pin at crosshair) ---
  function markLocation() {
    const center = map.getCenter();

    // Animate crosshair
    crosshair.classList.add("dropping");
    setTimeout(() => crosshair.classList.remove("dropping"), 200);

    const loc = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      latitude: center.lat,
      longitude: center.lng,
      timestamp: new Date().toISOString(),
    };

    locations.push(loc);
    persistLocations();
    addMarkerToMap(loc);
    renderList();
    setStatus(`Marked: ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`);
  }

  // --- Map markers ---
  function addMarkerToMap(loc) {
    const icon = L.divIcon({
      className: "custom-marker",
      iconSize: [14, 14],
    });
    const marker = L.marker([loc.latitude, loc.longitude], { icon })
      .addTo(map)
      .bindPopup(
        `<strong>${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}</strong><br>
         <small>${new Date(loc.timestamp).toLocaleString()}</small>`
      );
    markers.push({ id: loc.id, marker });
  }

  function removeMarkerFromMap(id) {
    const idx = markers.findIndex((m) => m.id === id);
    if (idx !== -1) {
      map.removeLayer(markers[idx].marker);
      markers.splice(idx, 1);
    }
  }

  // --- Panel list ---
  function renderList() {
    emptyMsg.style.display = locations.length === 0 ? "block" : "none";
    locationList.innerHTML = "";

    locations.forEach((loc) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="loc-info">
          <div class="loc-coords">${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}</div>
          <div class="loc-time">${new Date(loc.timestamp).toLocaleString()}</div>
        </div>
        <button class="loc-delete" title="Delete">&times;</button>
      `;

      li.querySelector(".loc-info").addEventListener("click", () => {
        map.flyTo([loc.latitude, loc.longitude], 17, { duration: 0.8 });
        panel.classList.add("hidden");
      });

      li.querySelector(".loc-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteLocation(loc.id);
      });

      locationList.appendChild(li);
    });
  }

  function deleteLocation(id) {
    locations = locations.filter((l) => l.id !== id);
    persistLocations();
    removeMarkerFromMap(id);
    renderList();
    setStatus("Location deleted");
  }

  function clearAll() {
    if (!confirm("Delete all saved locations?")) return;
    markers.forEach((m) => map.removeLayer(m.marker));
    markers = [];
    locations = [];
    persistLocations();
    renderList();
    setStatus("All locations cleared");
  }

  // --- Export ---
  function exportJSON() {
    if (locations.length === 0) {
      setStatus("No locations to export");
      return;
    }

    const data = {
      exported: new Date().toISOString(),
      count: locations.length,
      locations: locations.map(({ id, ...rest }) => rest),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gps-locations-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${locations.length} location(s)`);
  }

  // --- Storage ---
  function loadLocations() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function persistLocations() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(locations));
  }

  // --- Helpers ---
  function setStatus(msg) {
    statusBar.textContent = msg;
  }

  // --- Events ---
  btnLocate.addEventListener("click", locateUser);
  btnMark.addEventListener("click", markLocation);

  btnList.addEventListener("click", () => {
    renderList();
    panel.classList.toggle("hidden");
  });

  btnClosePanel.addEventListener("click", () => panel.classList.add("hidden"));
  btnExport.addEventListener("click", exportJSON);
  btnExportPanel.addEventListener("click", exportJSON);
  btnClearAll.addEventListener("click", clearAll);

  // --- Register service worker ---
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js");
  }

  // --- Start ---
  initMap();
  renderList();
})();
