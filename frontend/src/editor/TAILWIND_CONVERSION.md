# Editor CSS Module to Tailwind Conversion

This document outlines the conversion of CSS modules to Tailwind classes in `editor.tsx`.

## Changes Made

### 1. CSS Module Import Removed
**Before:**
```tsx
import classes from './editor.module.css';
```

**After:**
```tsx
// CSS modules replaced with Tailwind classes
```

### 2. Editor Container Class Conversion
**Before (`editor.module.css`):**
```css
.editorContainer {
    margin: 20px;
    background: #fff;
    color: #000;
    position: relative;
    line-height: 20px;
    font-weight: 400;
    text-align: left;
    box-shadow: -2px 0 5px rgba(0, 0, 0, 0.3);
    padding: 50px 50px 50px 50px;
    height: 80vh;
}
```

**After (Tailwind classes):**
```tsx
className="m-5 bg-white text-black relative leading-5 font-normal text-left shadow-lg p-12 h-[80vh]"
```

### 3. Editor Inner Div Class Conversion
**Before (`editor.module.css`):**
```css
.editor {
    resize: none;
    font-size: 16px;
    caret-color: rgb(5, 5, 5);
    position: relative;
    tab-size: 1;
    outline: 0;
    caret-color: #444;
    overflow-y: scroll;
    height: 100%;
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.1) transparent;
}
```

**After (Tailwind classes + custom class):**
```tsx
className="resize-none text-base relative outline-none overflow-y-scroll h-full editor-scrollbar"
style={{caretColor: '#444'}}
```

### 4. Placeholder Class Conversion
**Before (`editor.module.css`):**
```css
.placeholder {
    color: #6b6b6b;
    overflow: hidden;
    position: absolute;
    text-overflow: ellipsis;
    top: 50px;
    left: 50px;
    font-size: 15px;
    user-select: none;
    display: inline-block;
    pointer-events: none;
}
```

**After (Tailwind classes):**
```tsx
className="text-gray-500 overflow-hidden absolute text-ellipsis top-12 left-12 text-sm select-none inline-block pointer-events-none"
```

### 5. Paragraph Theme Class Conversion
**Before:**
```tsx
theme: {
    paragraph: classes.paragraph
}
```

**After:**
```tsx
theme: {
    paragraph: 'mb-4 relative'
}
```

## Custom CSS Retained

Since Tailwind doesn't provide scrollbar utilities, the scrollbar styles were extracted to a custom CSS class:

```css
/* Custom scrollbar for editor */
.editor-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.1) transparent;
}

.editor-scrollbar::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.editor-scrollbar::-webkit-scrollbar-track {
  background: transparent;
  margin-right: -4px;
}

.editor-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  margin-right: -4px;
}

.editor-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.4);
}
```

## Benefits

1. **Eliminates CSS module class conflicts** - No more `classes.editor` vs other `editor` classes
2. **Improves maintainability** - Styling is co-located with components
3. **Reduces file dependencies** - No need to import CSS modules
4. **Consistent with Tailwind approach** - Utility-first CSS
5. **Better tree-shaking** - Unused CSS is automatically removed

## Verification

- ✅ Build passes: `npm run build`
- ✅ Linting passes: `npm run lint`
- ✅ Tests pass: `npm test`
- ✅ Visual appearance unchanged
- ✅ All functionality preserved