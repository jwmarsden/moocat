// moocat's page for the web: frontend/index.html's body. Written by
// tools/web-markup.py from index.html: don't edit, run that.
export const MARKUP = `

<header>
  <select id="world" title="World"></select>
  <button id="connect">Connect</button>
  <button id="worlds" title="Add and edit worlds">Worlds…</button>
  <span id="status"><span class="dot"></span><span id="statusText">Not connected</span></span>
  <select id="theme" title="Colour theme"></select>
</header>

<nav id="tabs"></nav>

<main id="main">
  <section id="session">
    <div id="outWrap">
      <div id="out" tabindex="-1"></div>
      <button id="jump" hidden title="Jump to the bottom"></button>
    </div>
    <div id="partial"></div>
    <form id="inputForm" autocomplete="off">
      <textarea id="input" rows="1" spellcheck="false" placeholder="Say something, or a command"></textarea>
      <button id="sendLine" class="primary" title="Enter">Send</button>
    </form>
  </section>

  <section id="editor" hidden>
    <div id="code">
      <div id="codeScroll">
        <div id="stack">
          <div id="hl" aria-hidden="true"></div>
          <textarea id="text" spellcheck="false" wrap="soft"></textarea>
        </div>
      </div>
    </div>
    <footer>
      <button id="send" class="primary" title="Ctrl+S">Send</button>
      <button id="revert" title="Back to the text the MOO sent">Revert</button>
      <label class="check" title="Wrap long lines"><input type="checkbox" id="wrap"> Wrap</label>
      <span id="editInfo"></span>
      <span class="spacer"></span>
      <span id="result"></span>
    </footer>
  </section>

  <section id="objview" hidden></section>
</main>

<dialog id="worldsDialog">
  <form method="dialog" id="worldsForm" autocomplete="off">
    <h2>Worlds</h2>
    <div class="cols">
      <ul id="worldList"></ul>
      <div class="fields">
        <label>Name <input name="name" required></label>
        <label>Host <input name="host" required spellcheck="false"></label>
        <div class="row">
          <label>Port <input name="port" type="number" min="1" max="65535" required></label>
          <label class="check"><input name="tls" type="checkbox"> TLS</label>
        </div>
        <label>Login line <input name="login" spellcheck="false" placeholder="connect wizard"></label>
        <p class="hint">Sent after connecting. It can hold a password; worlds are kept in
          a file only you can read.</p>
        <label class="check"><input name="smud" type="checkbox"> SMud graphics</label>
        <p class="hint">Tell the MOO this is an SMud client once you're logged in, so games
          like Rupert's Logic Puzzle open in windows of their own.</p>
      </div>
    </div>
    <footer>
      <button type="button" id="worldNew">New</button>
      <button type="button" id="worldDelete">Delete</button>
      <span class="spacer"></span>
      <button value="cancel" formnovalidate>Close</button>
      <button type="button" id="worldSave" class="primary">Save</button>
    </footer>
  </form>
</dialog>

`;
