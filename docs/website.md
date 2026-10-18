# Website

Open https://techluddite.github.io/Luddite-Scout/ and enter `owner/repo` or a GitHub URL. Everything runs in your browser. Results are not stored or shareable by link.

## Running your own copy

There is no build step:

```sh
git clone https://github.com/TechLuddite/Luddite-Scout.git
cd Luddite-Scout
python3 -m http.server 8000
```

Then open http://localhost:8000.

The page's Content Security Policy allows connections only to the four hosts listed in [data handling](data-handling.md).
