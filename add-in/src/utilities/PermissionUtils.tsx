export async function checkDocumentOptIn(): Promise<boolean> {
    return new Promise((resolve) => {
        const hasOptedIn = Office.context.document.settings.get('hasOptedIn');
        if (hasOptedIn === undefined) {
            resolve(false); // Default to false if the setting is not found
        }
 else {
            resolve(hasOptedIn);
        }
    });
}

export async function setDocumentOptIn(optIn: boolean): Promise<void> {
    return new Promise((resolve) => {
        Office.context.document.settings.set('hasOptedIn', optIn);
        Office.context.document.settings.saveAsync(() => {
            resolve();
        });
    });
}
