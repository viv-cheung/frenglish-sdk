export type File = {
    id: number;
    projectID: number;
    translationID: number | null;
    fileId: string;
    s3Version: string;
    originLanguageS3Version: string | null;
    language: string;
    isProjectTextMap: boolean;
    createdAt: Date;
    lastModifiedAt: Date;
    project?: {
      id: number;
    };
    getUUID(): string;
    getURL(): string;
  };