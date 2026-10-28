'use strict';

const checkMeta = {
  search: {
    defaultNote: 'Your recent public posts may be missing from X’s Latest search results.',
    autoName: 'SEARCH INDEX · AUTOMATIC', manualName: 'SEARCH INDEX · GUIDED'
  },
  suggestion: {
    defaultNote: 'See if your account appears as you type your handle into X’s search suggestion dropdown.',
    autoName: 'AUTOCOMPLETE · AUTOMATIC', manualName: 'AUTOCOMPLETE · GUIDED'
  },
  ghost: { defaultNote: 'Check whether your replies appear in the original conversation from a non-follower’s view.' },
  deboost: { defaultNote: 'Find out if your replies are pushed behind “Show more replies” or a similar collapsed section.' }
};
const names = Object.keys(checkMeta);
const $ = (selector) => document.querySelector(selector);
const state = { username: null, apiAvailable: false, ready: false, results: {}, protectedAccount: false, loading: false };

function normalizeHandle(value) {
  const match = String(value || '').trim().match(/^(?:(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/)?@?([A-Za-z0-9_]{1,15})(?:\/)?(?:\?.*)?$/i);
  return match ? match[1] : null;
}
function blankResult(name) { return { status: 'untested', source: 'guided', note: checkMeta[name].defaultNote }; }
function setResult(name, status, source = 'guided', note) {
  state.results[name] = { status, source, note: note || checkMeta[name].defaultNote };
}
function setLoading(isLoading) {
  state.loading = isLoading;
  $('#scanBtn').disabled = isLoading;
  $('#scanButtonText').textContent = isLoading ? 'Checking…' : 'Check visibility';
}
function setProviderMode(automatic) {
  state.apiAvailable = automatic;
  state.ready = true;
  const pill = $('#modePill');
  pill.classList.toggle('is-guided', !automatic);
  pill.lastChild.textContent = automatic ? ' AUTO SCAN AVAILABLE' : ' GUIDED CHECK AVAILABLE';
}
function statusLabel(result) {
  if (result.status === 'issue') return result.source === 'automatic' ? 'SIGNAL FOUND' : 'ISSUE REPORTED';
  if (result.status === 'clear') return result.source === 'automatic' ? 'NO SIGNAL' : 'VISIBLE REPORTED';
  if (result.status === 'unknown') return 'INCONCLUSIVE';
  return 'NOT TESTED';
}
function renderChecks() {
  for (const name of names) {
    const card = document.querySelector(`[data-check="${name}"]`);
    const result = state.results[name] || blankResult(name);
    const label = card.querySelector(`[data-status="${name}"]`);
    label.className = 'check-status is-' + (result.status === 'issue' ? 'issue' : result.status === 'clear' ? 'clear' : result.status === 'unknown' ? 'unknown' : 'untested');
    label.textContent = statusLabel(result);
    card.querySelector(`[data-note="${name}"]`).textContent = result.note;
    const source = card.querySelector(`[data-source="${name}"]`);
    if (source) source.textContent = result.source === 'automatic' ? checkMeta[name].autoName : checkMeta[name].manualName;
    const guided = card.querySelector(`[data-manual="${name}"]`);
    guided.hidden = result.source === 'automatic';
    guided.querySelectorAll('button[data-answer]').forEach((button) => {
      const selected = result.source === 'guided' && (result.status === 'issue' ? button.dataset.answer === 'issue' : result.status === 'clear' ? button.dataset.answer === 'clear' : result.status === 'unknown' ? button.dataset.answer === 'unknown' : false);
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
}
function renderSummary() {
  const entries = names.map((name) => state.results[name] || blankResult(name));
  const reviewed = entries.filter((check) => check.status !== 'untested').length;
  const issues = entries.filter((check) => check.status === 'issue');
  const clean = entries.filter((check) => check.status === 'clear');
  const manualIssues = issues.filter((check) => check.source !== 'automatic');
  const autoIssues = issues.filter((check) => check.source === 'automatic');
  const panel = $('#summaryPanel');
  panel.classList.remove('tone-neutral', 'tone-warning', 'tone-good');
  let tone = 'tone-neutral', symbol = '◉', eyebrow = 'VISIBILITY STATUS', title, description;
  if (state.loading) {
    title = 'Checking public visibility…';
    description = 'We’re gathering what can be measured. Unavailable signals will remain inconclusive.';
  } else if (state.protectedAccount) {
    title = 'Protected account';
    description = 'Private posts are not publicly searchable. Search visibility cannot be assessed from an outside view.';
  } else if (issues.length) {
    tone = 'tone-warning'; symbol = '!'; eyebrow = 'POSSIBLE VISIBILITY CONCERN';
    title = autoIssues.length ? 'A visibility signal was detected' : 'A potential issue was reported';
    description = manualIssues.length
      ? 'Some findings were reported from manual checks. Verify again with another viewer before drawing conclusions.'
      : 'An external search or suggestion test detected a missing-visibility signal. This does not establish why it happened.';
  } else if (clean.length) {
    tone = 'tone-good'; symbol = '✓'; eyebrow = 'NO ISSUE IN COMPLETED CHECKS';
    title = 'No restriction found in tested areas';
    description = reviewed === 4 && clean.length === 4
      ? 'All four checks were marked clear. Manual observations are not official X findings.'
      : 'Some checks are incomplete or inconclusive. Clean signals do not guarantee unrestricted reach.';
  } else {
    title = 'Review the checks below';
    description = reviewed ? 'The completed tests could not establish a result. Try again or test from another viewer.' : 'Use the links and answer the guided questions to build a report.';
  }
  panel.classList.add(tone);
  $('#summarySymbol').textContent = symbol;
  $('#summaryEyebrow').textContent = eyebrow;
  $('#summaryTitle').textContent = title;
  $('#summaryDescription').textContent = description;
  $('#counterValue').textContent = `${reviewed}/4`;
}
function render() { renderChecks(); renderSummary(); }
function updateLinks(username) {
  const encoded = encodeURIComponent(username);
  const searchQuery = encodeURIComponent(`from:${username} -filter:replies`);
  document.querySelector('[data-link="search"]').href = `https://x.com/search?q=${searchQuery}&f=live`;
  document.querySelector('[data-link="suggestion"]').href = 'https://x.com/search';
  document.querySelector('[data-link="ghost"]').href = `https://x.com/${encoded}/with_replies`;
  document.querySelector('[data-link="deboost"]').href = `https://x.com/${encoded}/with_replies`;
  $('#reportProfile').href = `https://x.com/${encoded}`;
  $('#reportProfile').textContent = `@${username} ↗`;
}
function initReport(username) {
  state.username = username;
  state.protectedAccount = false;
  state.results = Object.fromEntries(names.map((name) => [name, blankResult(name)]));
  updateLinks(username);
  $('#report').hidden = false;
  $('#reportTime').textContent = 'Awaiting visibility checks';
  $('#resultsModeText').textContent = 'Complete the checks below for a meaningful result.';
  render();
  const url = new URL(window.location.href);
  url.searchParams.set('username', username);
  window.history.replaceState({}, '', url.pathname + url.search);
}
async function submitCheck(event) {
  event.preventDefault();
  if (state.loading) return;
  $('#handleError').textContent = '';
  const username = normalizeHandle($('#handleInput').value);
  if (!username) {
    $('#handleError').textContent = 'Enter a valid @handle or x.com/username profile link.';
    $('#handleInput').focus();
    return;
  }
  initReport(username);
  setLoading(true);
  $('#report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!state.ready) await configPromise;
  if (!state.apiAvailable) {
    setLoading(false);
    $('#resultsModeText').textContent = 'Guided mode · Open X links and record what you observe.';
    $('#reportTime').textContent = 'Guided check · ' + new Date().toLocaleString();
    render();
    return;
  }
  $('#resultsModeText').textContent = 'Searching X visibility via the configured data provider. Reply checks remain guided.';
  render();
  try {
    const response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Automatic checks could not be completed.');
    state.protectedAccount = data.account?.protected === true;
    for (const [name, apiName] of [['search', 'search'], ['suggestion', 'suggestion']]) {
      const check = data.checks?.[apiName];
      const status = check?.status === 'clean' ? 'clear' : check?.status === 'banned' ? 'issue' : 'unknown';
      setResult(name, status, 'automatic', check?.reason || (status === 'unknown' ? 'The provider could not establish this signal.' : status === 'clear' ? 'This signal was not observed in the latest provider check.' : 'This visibility signal was detected in the provider check.'));
    }
    const checked = data.checkedAt ? new Date(data.checkedAt) : new Date();
    $('#reportTime').textContent = `Automatic check · ${Number.isNaN(checked.getTime()) ? new Date().toLocaleString() : checked.toLocaleString()}${data.cached ? ' · Cached' : ''}`;
    $('#resultsModeText').textContent = 'Search and suggestions: data-provider measurements · Replies: guided verification.';
  } catch (error) {
    setResult('search', 'untested', 'guided');
    setResult('suggestion', 'untested', 'guided');
    $('#resultsModeText').textContent = (error?.message || 'Automatic check unavailable.') + ' Use the guided checks below.';
    $('#reportTime').textContent = 'Guided fallback · ' + new Date().toLocaleString();
  } finally {
    setLoading(false);
    render();
  }
}

const configPromise = fetch('/api/config').then(async (response) => {
  if (!response.ok) throw new Error('Configuration unavailable');
  return response.json();
}).then((data) => setProviderMode(data.automatic === true)).catch(() => setProviderMode(false));

$('#lookupForm').addEventListener('submit', submitCheck);
for (const card of document.querySelectorAll('.check-card')) {
  card.querySelectorAll('button[data-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.username) return;
      const name = card.dataset.check;
      const answer = button.dataset.answer;
      const status = answer === 'issue' ? 'issue' : answer === 'clear' ? 'clear' : 'unknown';
      let note;
      if (status === 'issue') {
        note = name === 'search' ? 'You reported missing recent public posts in Latest search. Check indexing delays, privacy and filters before concluding a search restriction.'
          : name === 'suggestion' ? 'You reported that the account is absent from the autocomplete dropdown. Ranking and account age can also affect suggestions.'
          : name === 'ghost' ? 'You reported a reply missing from the conversation. Test more than one thread with a different account.'
          : 'You reported a reply collapsed behind an additional-replies section. Ranking is viewer- and thread-dependent.';
      } else if (status === 'clear') {
        note = name === 'search' ? 'You reported that recent public posts appear in Latest search.'
          : name === 'suggestion' ? 'You reported that the handle appears in X’s autocomplete suggestions.'
          : name === 'ghost' ? 'You reported that the reply is visible from a different viewer’s account.'
          : 'You reported that replies appear in the normal thread rather than a collapsed section.';
      } else note = 'You could not verify this signal from a different account or browser. No conclusion is drawn.';
      setResult(name, status, 'guided', note);
      render();
    });
  });
}
$('#shareBtn').addEventListener('click', async () => {
  if (!state.username) return;
  const url = new URL('/', window.location.origin);
  url.searchParams.set('username', state.username);
  const button = $('#shareBtn');
  try {
    await navigator.clipboard.writeText(url.toString());
    button.textContent = 'Link copied ✓';
  } catch {
    button.textContent = 'Copy from the address bar';
  }
});
$('#footerYear').textContent = String(new Date().getFullYear());
const queryUser = new URLSearchParams(window.location.search).get('username');
const prefilled = normalizeHandle(queryUser);
if (prefilled) $('#handleInput').value = '@' + prefilled;
