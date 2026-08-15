import * as vscode from 'vscode';

const scheme = 'pve-ssh-preview';

export class PreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly documents = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? '';
  }

  public create(label: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme,
      path: `/${encodeURIComponent(label)}`,
      query: `id=${crypto.randomUUID()}`,
    });
    this.documents.set(uri.toString(), content);
    return uri;
  }

  public get scheme(): string {
    return scheme;
  }
}
