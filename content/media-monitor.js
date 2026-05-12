/**
 * media-monitor.js — runs in the page's MAIN JavaScript context (world: "MAIN").
 *
 * Wraps getUserMedia and getDisplayMedia so Slumber can detect when a tab has
 * an active microphone, camera, or screen-share stream. Signals are sent to the
 * isolated-world relay (media-relay.js) via a CustomEvent on window, which
 * crosses the MAIN/isolated-world boundary because both share the same DOM.
 *
 * Per-stream tracking: a tab is "capturing" as long as at least one MediaStream
 * returned by either API has at least one track that has not yet ended.
 */
(function () {
  'use strict';

  if (!navigator.mediaDevices) return;

  const liveStreams = new Map(); // streamId → MediaStream

  function dispatch() {
    window.dispatchEvent(new CustomEvent('__slumber_capture', {
      detail: { active: liveStreams.size > 0 },
    }));
  }

  function watchStream(stream) {
    liveStreams.set(stream.id, stream);
    dispatch();

    const onEnded = () => {
      if (stream.getTracks().every(t => t.readyState === 'ended')) {
        liveStreams.delete(stream.id);
        dispatch();
      }
    };
    stream.getTracks().forEach(t => t.addEventListener('ended', onEnded));
  }

  const origGUM = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
  if (origGUM) {
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const stream = await origGUM(constraints);
      watchStream(stream);
      return stream;
    };
  }

  const origGDM = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
  if (origGDM) {
    navigator.mediaDevices.getDisplayMedia = async function (constraints) {
      const stream = await origGDM(constraints);
      watchStream(stream);
      return stream;
    };
  }
})();
