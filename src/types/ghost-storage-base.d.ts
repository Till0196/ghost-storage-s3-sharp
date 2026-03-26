declare module 'ghost-storage-base' {
    interface StorageFile {
        name: string;
        path: string;
        type?: string;
    }

    class StorageBase {
        requiredFns: string[];
        getTargetDir(baseDir?: string): string;
        getUniqueFileName(file: StorageFile, targetDir: string): Promise<string>;
        getSanitizedFileName(fileName: string): string;
    }

    export = StorageBase;
}
