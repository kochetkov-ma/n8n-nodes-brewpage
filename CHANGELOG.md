# Changelog

## 0.2.0

- Publish HTML pages that save visitor answers, with Page data settings in Options.
- Use an existing owner credential to retain author access and request a custom domain.
- Keep ordinary anonymous reports and saved workflow node version 1 unchanged.

## 0.1.5

- Lifetime (Days) moved into an Options collection; it defaults to 15 days when
  not added. Workflows that set Lifetime before 0.1.5 publish with 15 days until
  it is set again under Options.
- The retention notice left the node form; its guidance is now in the Content
  field description and the README.
- README describes installing the verified node from the n8n nodes panel.

## 0.1.4

- Moved to its own repository in the n8n starter layout:
  https://github.com/kochetkov-ma/n8n-nodes-brewpage. Node behaviour is unchanged.
- Published from a tag-triggered GitHub Actions workflow with npm provenance.

## 0.1.3

- Accept every create link shape BrewPage returns (`/<namespace>/<id>` paths and
  the page's own host).

## 0.1.2

- Accurate provenance documentation.

## 0.1.1

- Pass the official n8n lint; use n8n error types.

## 0.1.0

- First release: publish HTML and Markdown reports as temporary reader links.
