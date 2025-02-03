export type FileContent = {
    fileId: string
    content: string
}

export interface FileContentWithLanguage {
    language: string;
    fileId: string;
    content: string;
}

export type TranslationResponse = {
    language: string
    files: FileContent[]
}

export type TranslationStatusResponse = {
    TranslationStatus
}

export type RequestTranslationResponse = {
    translationId: number,
    content: TranslationResponse[]
}