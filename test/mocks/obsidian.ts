export class TAbstractFile {
  path = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  extension = "";
}

export class TFolder extends TAbstractFile {
  name = "";
  children: TAbstractFile[] = [];
}

export class FileSystemAdapter {
  getBasePath(): string {
    return "/vault";
  }
}

export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl is not available in unit tests.");
}
