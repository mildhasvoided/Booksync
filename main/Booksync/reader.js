const fileInput = document.getElementById('fileInput');
const loadProgressBtn = document.getElementById('loadProgressBtn');
const saveProgressBtn = document.getElementById('saveProgressBtn');
const refreshProgressBtn = document.getElementById('refreshProgressBtn');
const syncStatus = document.getElementById('syncStatus');
const timeDisplay = document.getElementById('time-display');
const pageDisplay = document.getElementById('page-display');

// Start the clock!
function updateClock() {
    const now = new Date();
    timeDisplay.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

let book = ePub();
let rendition;
let currentCfi = null; // Holds the exact location you are currently reading
let savedCfi = null;   // Holds a location loaded from a .txt file before the book was opened

// --- Chapter Progress Tracking ---
let tocPageMap = []; // [{label, startPage}] built once locations are ready

// We are now using a button that calls showOpenFilePicker
// This allows us to use an ID to remember the last opened directory!
fileInput.addEventListener('click', async () => {
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{
                description: 'EPUB Books',
                accept: { 'application/epub+zip': ['.epub'] }
            }],
            multiple: false,
            id: 'book-picker-location' // Browser remembers path for this ID
        });
        
        const file = await handle.getFile();
        if (!file) return;

        console.log("File loaded:", file.name);

        // Read the file as an ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        
        // Clear previous book data if any
    if (book && book.isOpen) {
        book.destroy();
    }
    book = ePub(); // Create a fresh instance

    // Open the book using the epub.js library
    book.open(arrayBuffer, "binary");

    // Render it to our visual div
    rendition = book.renderTo("book-viewer", {
        width: "100%", 
        height: "100%", 
        spread: "none" // Display as a single scrolling page/column
    });

    // epub.js uses an iframe, so normal CSS doesn't apply. We must tell the rendition to override text styles:
    rendition.themes.default({
        "*": {
            "color": "black !important"
        },
        "body": {
            "background-color": "white !important",
            "color": "black !important"
        },
        "a": {
            "color": "#fc0000 !important"
        }
    });

    pageDisplay.innerText = "Calculating pages...";
    let totalPages = 0; // We will store the full count here to prevent bugs

    // Step 1: Run the page calculation FIRST
    book.ready.then(() => {
        // Warning: on massive books, this specific function takes a long time. 
        // 1600 chars is an average screen, speeds up calculation vs 1024
        return book.locations.generate(1600); 
    }).then((locations) => {
        // Grab the total reliably
        totalPages = locations.length; 
        console.log("Pages calculated! Total:", totalPages);

        // Build TOC → page map now that locations are ready
        // Strategy: for each TOC entry, generate a CFI to the first character of that spine item,
        // then ask locations what page that CFI lands on.
        book.loaded.navigation.then(function(nav) {
            tocPageMap = [];
            function buildMap(items) {
                items.forEach(function(item) {
                    const spineItem = book.spine.get(item.href);
                    if (spineItem) {
                        // Construct a CFI pointing to the very start of this spine item
                        const startCfi = `epubcfi(${spineItem.cfiBase}!/4/2)`;
                        const page = book.locations.locationFromCfi(startCfi);
                        const pageNum = (typeof page === 'number' && page >= 0) ? page : null;
                        if (pageNum !== null) {
                            tocPageMap.push({ label: item.label.trim(), startPage: pageNum });
                        }
                    }
                    if (item.subitems && item.subitems.length > 0) buildMap(item.subitems);
                });
            }
            buildMap(nav);
            tocPageMap.sort((a, b) => a.startPage - b.startPage);
            console.log("TOC page map:", tocPageMap);
        });

        // Step 2: NOW that math is done, safely trigger the load/display of the text sync!
        if (savedCfi) {
            rendition.display(savedCfi);
        } else {
            rendition.display();
        }

        // Force an immediate UI update so the numbers don't stick to calculating if you didn't move!
        if (rendition.location && rendition.location.start) {
            const myCurrentPage = rendition.location.start.location || book.locations.locationFromCfi(rendition.location.start.cfi) || 1;
            pageDisplay.innerText = `Page: ${myCurrentPage} of ${totalPages}`;
        }
    }).catch((err) => {
        console.error("Page calculation failed:", err);
        pageDisplay.innerText = "Page: ?";
        
        // Fallback: If math completely fails, just load the book anyway so user isn't stuck holding a white screen
        if (savedCfi) { rendition.display(savedCfi); } else { rendition.display(); }
    });

    // Every time the page is turned or changed, save the new exact location!
    rendition.on('relocated', function(location) {
        currentCfi = location.start.cfi;
        
        // Let epub.js tell us EXACTLY what absolute location we are on, don't guess!
        // This ensures the screen sizes and "skipping" correctly report the true location.
        if (totalPages > 0) {
            myCurrentPage = book.locations.locationFromCfi(currentCfi);
            pageDisplay.innerText = `Page: ${myCurrentPage} of ${totalPages}`;
        }
    });

    // TOC Loading
    book.loaded.navigation.then(function(toc) {
        const select = document.getElementById("toc-select");
        select.innerHTML = '<option value="">Select a chapter...</option>';
        function createOptions(items, depth) {
            items.forEach(function(item) {
                const option = document.createElement("option");
                option.textContent = "- ".repeat(depth) + item.label;
                option.value = item.href;
                select.appendChild(option);
                if (item.subitems && item.subitems.length > 0) {
                    createOptions(item.subitems, depth + 1);
                }
            });
        }
        createOptions(toc, 0);

        select.onchange = function() {
            const index = select.selectedIndex;
            if (index >= 0) {
                const selectedOption = select.options[index];
                // Remove the indentation "- " prefixes to get cleaner chapter name
                let chapterName = selectedOption.text.replace(/^(- )+/, "");
                
                // Remove the word "Chapter " if it exists at the start
                chapterName = chapterName.replace(/^Chapter\s+/i, "");
                
                const searchInput = document.getElementById("search-input");
                if (searchInput) {
                    searchInput.value = chapterName;
                }
            }

            const target = this.value; // RE-ADDED: Define target
            if (target && rendition) {
                 // Try to strip spaces, sometimes EPUBs have messy links
                 const cleanTarget = target.trim();
                 rendition.display(cleanTarget).catch(err => {
                    console.warn(`Chapter navigation failed for target "${target}". Trying fallback...`, err);
                    
                    // Fallback: Sometimes just the filename works if the #hash part is broken
                    if (cleanTarget.includes('#')) {
                        const fallback = cleanTarget.split('#')[0];
                        console.log(`Attempting fallback navigation to: ${fallback}`);
                        rendition.display(fallback);
                    }
                 });
            }
        };
    });



    // NOTE: Removed the fake manual "myCurrentPage++" trackers because if a massive screen 
    // puts 3 "pages" of characters on a single screen, hitting "next" visually jumps 3 pages! 
    // Forcing it to say +1 breaks the true tracking math!
    } catch (err) {
        // If user cancels the picker, it's not an error to worry about
        if (err.name !== 'AbortError') {
             console.error("Book load failed:", err);
        }
    }
});

// --- Progress Syncing Logic ---

let progressFileHandle = null;

// 1. Loading/Linking to a .txt file
loadProgressBtn.addEventListener('click', async () => {
    try {
        // Use the modern File System API to get a "handle" on the actual file on your drive
        [progressFileHandle] = await window.showOpenFilePicker({
            types: [{ description: 'Text Files', accept: {'text/plain': ['.txt']} }],
            multiple: false,
            id: 'sync-picker-location' // Browser remembers path for this ID
        });
        
        const file = await progressFileHandle.getFile();
        const text = await file.text();
        
        // Try to parse the new format if it exists
        let cfi = text.trim();
        if (text.includes("CFI: \"")) {
            const match = text.match(/CFI: "([^"]+)"/);
            if (match && match[1]) {
                cfi = match[1];
            }
        }
        
        syncStatus.innerText = `Linked to: ${file.name}`;

        // Always update the saved location in memory!
        savedCfi = cfi;

        if (rendition && cfi) {
            // If the book is already open, instantly flip to the page!
            rendition.display(cfi);
        } else if (cfi) {
            // If the book isn't open yet, stash it to use when the book loads
            console.log("Progress loaded! Open your book and it will jump to this location automatically.");
        }
    } catch (err) {
        console.log("File load cancelled or failed.", err);
    }
});

// Refresh button logic
refreshProgressBtn.addEventListener('click', () => {
    if (rendition && savedCfi) {
        console.log("Refreshing to saved CFI:", savedCfi);
        rendition.display(savedCfi);
    } else {
        alert("No saved progress found or book not loaded yet.");
    }
});

// 2. Saving DIRECTLY to the .txt file
saveProgressBtn.addEventListener('click', async () => {
    // Snapshot NOW before any async/fullscreen-exit can shift currentCfi
    const cfiToSave = (currentCfi || savedCfi) + '';

    if (!cfiToSave || cfiToSave === 'null' || cfiToSave === 'undefined') {
        alert("You need to load a book and optionally flip a page first!");
        return;
    }
    
    // Default content is just the CFI
    let fileContent = `CFI: "${cfiToSave}"`; 

    try {
        // Asynchronous logic to get metadata (Title, Chapter, Page)
        if (book && book.spine) { // Removed renderer check to be safe
             try {
                 const metadata = await book.loaded.metadata;
                 const title = metadata.title || "Unknown Book";
                 
                 // Get cleaner chapter name
                 let chapter = "Unknown Chapter";
                 const item = book.spine.get(cfiToSave);
                 if (item) {
                     // Try to match href to TOC
                     // Ensure navigation is loaded
                     const navigation = await book.loaded.navigation;
                     if (navigation) {
                        const tocItem = navigation.find(t => t.href && item.href && t.href.indexOf(item.href) !== -1);
                        if (tocItem) chapter = tocItem.label.trim();
                        else chapter = `Section ${item.index}`;
                     }
                 }

                 // Get cleaner page number
                 let page = "Unknown";
                 if (book.locations.length() > 0) {
                     page = book.locations.locationFromCfi(cfiToSave);
                 }

                 fileContent = `Book: "${title}"\nChapter: "${chapter}"\nPage: "${page}"\nCFI: "${cfiToSave}"`;
             } catch (metaErr) {
                 console.warn("Could not extract metadata, saving raw CFI only.", metaErr);
             }
        }

        // If they haven't loaded a file first, let them create one now!
        if (!progressFileHandle) {
            progressFileHandle = await window.showSaveFilePicker({
                suggestedName: 'Reading_Progress.txt',
                types: [{ description: 'Text Files', accept: {'text/plain': ['.txt']} }],
                id: 'sync-picker-location' // Share location with load button
            });
            const file = await progressFileHandle.getFile();
            syncStatus.innerText = `Linked to: ${file.name}`;
        }

        // Write directly to the file on the user's hard drive!
        const writable = await progressFileHandle.createWritable();
        await writable.write(fileContent);
        await writable.close();

        // Give a quick visual confirmation!
        const originalText = saveProgressBtn.innerText;
        saveProgressBtn.innerText = "Saved!";
        setTimeout(() => saveProgressBtn.innerText = originalText, 1500);

    } catch (err) {
        console.error("Save failed:", err);
        
        // Fallback for older browsers just in case
        // Note: dataToSave was undefined in previous version, fixed here to use fileContent or cfiToSave
        if (err.name !== 'AbortError' && !window.showSaveFilePicker) {
            const blob = new Blob([fileContent], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "Reading_Progress.txt";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }
});

// Setup button listeners
// The visual update for page numbers happens cleanly via logic added natively into these listeners up above!
document.getElementById('next').addEventListener('click', () => {
    if (rendition) rendition.next();
});

document.getElementById('back').addEventListener('click', () => {
    if (rendition) rendition.prev();
});

document.getElementById('Save').addEventListener('click', () => {
    saveProgressBtn.click();
});

document.getElementById('fullscreen').addEventListener('click', () => {
    // Instead of making the whole page fullscreen, make just the book viewer fullscreen!
    const elem = document.getElementById('book-viewer'); 
    
    // Check if we are currently in fullscreen mode
    if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) { /* Safari */
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) { /* IE11 */
            elem.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* Safari */
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { /* IE11 */
            document.msExitFullscreen();
        }
    }
});

// Optional but highly recommended: automatically tell epub.js to resize the book 
// when the window size changes (like entering/exiting fullscreen)
window.addEventListener("resize", () => {
    if (rendition) {
        rendition.resize("100%", "100%");
    }
});

// Add keyboard support for page flipping
document.addEventListener('keyup', (event) => {
    if (!rendition) return;

    if (event.key === 'ArrowLeft') {
        rendition.prev();
    } else if (event.key === 'ArrowRight') {
        rendition.next();
    }
});

// Search Logic
// Info-box fade: visible on activity, fades out after 10s
const infoBox = document.getElementById('info-box');
let infoFadeTimer;
function resetInfoFade() {
    infoBox.style.opacity = '1';
    clearTimeout(infoFadeTimer);
    infoFadeTimer = setTimeout(() => {
        infoBox.style.opacity = '0.3';
    }, 10000);
}
document.addEventListener('mousemove', resetInfoFade);
document.addEventListener('click', resetInfoFade);
document.addEventListener('keyup', resetInfoFade);
resetInfoFade();

document.getElementById("search-btn").addEventListener("click", function() {
    const query = document.getElementById("search-input").value;
    const resultsList = document.getElementById("search-results");
    
    if (!query || !book || !book.spine) return;
    
    resultsList.innerHTML = "<li>Searching...</li>";
    
    Promise.all(
        book.spine.spineItems.map(item => {
            return item.load(book.load.bind(book))
                .then(item.find.bind(item, query)) 
                .finally(item.unload.bind(item));
        })
    ).then(results => [].concat.apply([], results)).then(function(results) {
        resultsList.innerHTML = "";
        if (results.length === 0) {
            resultsList.innerHTML = "<li>No results found.</li>";
        } else {
            results.slice(0, 30).forEach(result => {
                const li = document.createElement("li");
                li.style.cursor = "pointer";
                li.style.textDecoration = "underline";
                li.style.color = "#88b7ff";
                li.style.marginBottom = "5px";
                li.textContent = "..." + (result.excerpt || "Result") + "...";
                li.addEventListener("click", function() {
                    if (rendition) {
                        rendition.display(result.cfi);
                    }
                });
                resultsList.appendChild(li);
            });
        }
    }).catch(err => {
        console.error("Search failed:", err);
        resultsList.innerHTML = "<li>Search failed.</li>";
    });
});


