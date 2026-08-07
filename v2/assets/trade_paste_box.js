export function mountTradePasteBox(target, options) {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) return null;

  const {
    label,
    textareaId,
    rows = 5,
    placeholder = "",
    autofocus = false,
    actions = [],
    hint,
    summary,
    notice,
    notices,
  } = options;

  root.replaceChildren();
  const labelElement = document.createElement("label");
  labelElement.textContent = label;
  labelElement.htmlFor = textareaId;
  if (options.labelId) labelElement.id = options.labelId;
  root.append(labelElement);

  const textarea = document.createElement("textarea");
  textarea.id = textareaId;
  textarea.rows = rows;
  textarea.placeholder = placeholder;
  if (autofocus) textarea.autofocus = true;
  root.append(textarea);

  const actionRow = document.createElement("div");
  actionRow.className = "tradeLookupActions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.id = action.id;
    button.type = "button";
    button.textContent = action.label;
    if (action.hidden) button.hidden = true;
    if (action.secondary) button.className = "secondaryButton";
    actionRow.append(button);
  }
  root.append(actionRow);

  if (hint) root.append(buildParagraph(hint.id, "hint", hint.text || "", { ariaLive: hint.ariaLive }));
  if (summary) root.append(buildParagraph(summary.id, "hint", summary.text || "", { ariaLive: summary.ariaLive }));
  for (const noticeConfig of notices || (notice ? [notice] : [])) root.append(buildNotice(noticeConfig));

  return { root, textarea, actionRow };
}

function buildParagraph(id, className, text, { ariaLive } = {}) {
  const paragraph = document.createElement("p");
  paragraph.id = id;
  paragraph.className = className;
  paragraph.textContent = text;
  if (ariaLive) paragraph.setAttribute("aria-live", ariaLive);
  return paragraph;
}

function buildNotice({ id, summaryId, buttonId, buttonLabel }) {
  const notice = document.createElement("div");
  notice.id = id;
  notice.className = "receiveIgnoredNotice";
  notice.hidden = true;

  const summary = document.createElement("p");
  summary.id = summaryId;
  notice.append(summary);

  const button = document.createElement("button");
  button.id = buttonId;
  button.className = "secondaryButton";
  button.type = "button";
  button.textContent = buttonLabel;
  notice.append(button);

  return notice;
}
