# Put a VRML model in a Blogger post

Yes: host this viewer and its models on an HTTPS static website, then embed that page in Blogger with an iframe. Blogger does not need to load VRML or run the viewer's JavaScript directly. Your readers need a browser with WebGL 2.

The GitHub Pages domain is `github.io` (not `githab.io`). If your GitHub username is `przemelek` and the repository is `vrml`, the usual project-site address is `https://przemelek.github.io/vrml/`. Treat that as an example until GitHub shows the actual published address.

## 1. Prepare the website

From this project directory, run:

```sh
python3 scripts/package-site.py
```

This creates `dist/vrml-blog.zip`. This trial bundle includes only the BuffyPedia scenes and their assets, `stolik/originals/stolik7.wrl`, the viewer, its pinned Three.js dependencies and license, a compact embed page, and `.nojekyll`. Other apparatus models, previews, and the demo scene are excluded. The home page opens stolik7 and links to the BuffyPedia scenes. Creating the ZIP does not publish it.

The script also refreshes `dist/vrml-blog/` with the same files, removing files from previous builds. Upload that folder’s **contents**, keeping their directory structure. Uploading the ZIP itself will not make a working website.

The important structure is:

```text
index.html
embed.html
embed.js
vrml-viewer.js
vrml-animation.js
scene-utils.js
walking.js
.nojekyll
vendor/three/...
stolik/originals/stolik7.wrl
buffypedia/...
```

All module imports and model paths are relative, so the site works under a project subdirectory such as `/vrml/`. Keep `vendor` and the viewer together. Textures stay alongside their model files.

## 2. Publish with GitHub Pages

Use a new public repository named `vrml`, or an existing repository intended for this website. Add the unzipped site files at its root, then configure **Settings → Pages → Deploy from a branch**, choosing your publishing branch and **/(root)**. Keep `.nojekyll` at that root for this plain static site.

Use the **Visit site** address shown in Pages settings; that is the address to paste into Blogger. GitHub's [Pages setup guide](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) explains repository setup and publishing. If you already maintain `przemelek.github.io`, you can instead place these files in a `vrml/` subdirectory of its published files, without replacing the existing home page.

An existing HTTPS static host works too. It must serve JavaScript as JavaScript and permit the viewer page to be embedded: a restrictive `X-Frame-Options` header or CSP `frame-ancestors` policy can prevent Blogger from displaying it. Hosting only a `.wrl` file is insufficient; the viewer page and its dependencies are required.

## 3. Test the compact embed page first

For the measurement apparatus, open:

```text
https://przemelek.github.io/vrml/embed.html?src=stolik/originals/stolik7.wrl
```

This page contains the 3D viewer and its controls, without the surrounding gallery. It supports original viewpoints, animated instrument components, walking, and Play/Pause. Animations initially pause when a reader has requested reduced motion; they can press Play.

Examples of other models:

```text
embed.html?src=buffypedia/domek.wrl
embed.html?src=buffypedia/library.wrl
```

These example paths are relative to the published site's base URL. The included stolik7 model supports animation. `src` accepts a model hosted within this viewer's site directory. It does not accept an arbitrary external model URL. The Buffy models remain the existing static derivatives; the games' JavaScript behavior is not implemented.

Local test before publishing:

```sh
npm start
```

Then visit `http://localhost:8000/embed.html?src=stolik/originals/stolik7.wrl`. Do not use a `localhost` URL in the published blog: it would refer to each reader's own computer.

## 4. Embed it in a Blogger post

Create or edit a post, switch the editor to **HTML view**, and paste this where you want the model. Replace the example host with your published address:

```html
<iframe
  src="https://przemelek.github.io/vrml/embed.html?src=stolik/originals/stolik7.wrl"
  title="3D model of my MSc measurement apparatus"
  width="100%"
  height="600"
  loading="lazy"
  style="display:block;border:0;border-radius:8px;max-width:100%;">
</iframe>
<p>
  <a href="https://przemelek.github.io/vrml/embed.html?src=stolik/originals/stolik7.wrl"
     target="_blank" rel="noopener">Open the interactive model in a separate window</a>
</p>
```

Preview the post, check it on desktop and mobile, and publish when you are satisfied. Blogger's [HTML editing and HTTPS guidance](https://support.google.com/blogger/answer/6286127?hl=en) identifies the HTML editor and explains why embedded resources should use HTTPS. For a model on every page instead of one post, Blogger also supports gadgets through **Layout → Add a Gadget**; see [Blogger's layout guide](https://support.google.com/blogger/answer/176245).

The iframe has its own keyboard focus. Readers click inside the 3D scene before using WASD, Q/E, or arrow keys. The on-screen buttons also work. Adjust `height="600"` to fit your post. Avoid adding an iframe `sandbox` attribute unless you deliberately configure it to allow the module scripts and same-origin model requests.

## If something does not display

- **404 / blank page:** open the iframe URL directly. Check the repository subdirectory and capitalization of every filename.
- **Files work locally but not on the blog:** use HTTPS for the entire iframe URL; check whether your host permits framing. Keep model textures and module imports reachable.
- **WebGL error:** try another browser or inspect the browser's GPU status. This cannot be fixed by changing the model URL.
- **No keyboard movement:** click the canvas first; selecting the viewpoint dropdown intentionally stops walking.
- **No instrument animation:** use an original supported model and press Play if reduced-motion preferences paused it. `czujnik.wrl` has its original ROUTEs commented out; this viewer does not enable those comments.
- **A particular model is unavailable:** this trial bundle includes only BuffyPedia scenes and `stolik/originals/stolik7.wrl`.
- **Older viewer still appears:** the scripts use versioned URLs. When updating the hosted code later, bump its version query strings and reload. A Blog Preview or lazy iframe may need to be reopened after the new site has published.

GitHub Pages and the Blogger embed are not deployed or tested against your account by this project. Verify the direct hosted page before adding it to a public post.
