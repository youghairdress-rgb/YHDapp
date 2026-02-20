// ★ Tab Switching Logic for Phase 6
function switchPhase6Tab(tabName) {
  // Buttons
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(`tab-btn-${tabName}`)?.classList.add('active');

  // Content
  document.querySelectorAll('.phase6-tab-content').forEach((c) => c.classList.remove('active'));
  document.getElementById(`phase6-tab-${tabName}`)?.classList.add('active');

  // Wait for display transition then resize canvas if needed
  if (tabName === 'composite') {
    setTimeout(() => {
      // Trigger a redraw or resize if canvas depends on container size
      const canvas = document.getElementById('phase6-canvas');
      if (canvas) {
        // Force redraw logic if implemented, or just ensure it's visible
      }
    }, 300);
  }
}
