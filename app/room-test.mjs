export function roomPreviewScale(planWidth, planHeight, viewportWidth, viewportHeight) {
  if (![planWidth, planHeight, viewportWidth, viewportHeight].every(n => Number.isFinite(n) && n > 0)) return 1;
  return Math.min(viewportWidth / planWidth, viewportHeight / planHeight);
}

export function mountRoomTest(host, snapshot, client) {
  if (new URLSearchParams(location.search).get("roomTest") !== "1") return;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Test room detection";
  host.after(button);
  button.onclick = async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Room detection preview");
    dialog.style.cssText = "box-sizing:border-box;width:calc(100vw - 24px);height:calc(100dvh - 24px);max-width:none;max-height:none;margin:auto;padding:12px;overflow:hidden";
    const layout = document.createElement("div");
    layout.style.cssText = "height:100%;min-height:0;display:flex;flex-direction:column;gap:8px";
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";
    const content = document.createElement("div");
    content.style.cssText = "flex:1;min-height:0;min-width:0;display:flex;gap:8px";
    const viewport = document.createElement("div");
    viewport.setAttribute("aria-label", "Floor plan preview");
    viewport.style.cssText = "flex:1;min-width:0;min-height:0;overflow:auto;background:white";
    const roomList = document.createElement("aside");
    roomList.setAttribute("aria-label", "Proposed rooms");
    roomList.style.cssText = "flex:0 0 clamp(145px,22vw,240px);min-width:0;min-height:0;overflow:auto";
    roomList.hidden = true;
    content.append(viewport, roomList);
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close test";
    close.onclick = () => dialog.close();
    let resize;
    dialog.onclose = () => { resize?.disconnect(); dialog.remove(); };
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.style.margin = "0";
    toolbar.append(close);
    layout.append(toolbar, status, content);
    dialog.append(layout);
    document.body.append(dialog);
    dialog.showModal();
    try {
      const { workspaceId, asset, points } = snapshot();
      const image = new Image();
      image.src = asset.dataUrl;
      await image.decode();
      if (!dialog.isConnected) return;
      const bounds = axis => points.map(point => point[axis]);
      const left = Math.max(0, Math.floor(Math.min(...bounds("x"))));
      const top = Math.max(0, Math.floor(Math.min(...bounds("y"))));
      const width = Math.min(image.width, Math.ceil(Math.max(...bounds("x")))) - left;
      const height = Math.min(image.height, Math.ceil(Math.max(...bounds("y")))) - top;
      if (width < 1 || height < 1) throw new Error("Check the floor outline and plan alignment.");
      const scale = Math.min(1, 1800 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.style.cssText = "display:block;max-width:none;max-height:none;touch-action:none;margin:auto";
      viewport.append(canvas);
      let zoom = 1;
      function resizePlan() {
        const narrow = dialog.clientWidth < 680;
        content.style.flexDirection = narrow ? "column" : "row";
        roomList.style.flexBasis = narrow ? "min(20vh, 150px)" : "clamp(145px,22vw,240px)";
        if (!viewport.clientWidth || !viewport.clientHeight) return;
        // Use the same scale for both axes so room geometry and wall lengths are not distorted.
        const scale = roomPreviewScale(canvas.width, canvas.height, viewport.clientWidth, viewport.clientHeight) * zoom;
        canvas.style.width = Math.max(1, Math.floor(canvas.width * scale)) + "px";
        canvas.style.height = Math.max(1, Math.floor(canvas.height * scale)) + "px";
      }
      function zoomButton(label, change) {
        const control = document.createElement("button");
        control.type = "button";
        control.textContent = label;
        control.onclick = () => { zoom = change(zoom); resizePlan(); };
        toolbar.append(control);
      }
      zoomButton("Fit plan", () => 1);
      zoomButton("Zoom −", z => Math.max(1, z / 1.5));
      zoomButton("Zoom +", z => Math.min(4, z * 1.5));
      resize = new ResizeObserver(resizePlan);
      resize.observe(viewport);
      resizePlan();
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.save();
      ctx.scale(canvas.width/width,canvas.height/height);
      ctx.translate(-left,-top);
      ctx.beginPath();
      points.forEach((p,i)=>i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y));
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(image,0,0);
      ctx.restore();
      const clean = ctx.getImageData(0,0,canvas.width,canvas.height);
      const jpeg = canvas.toDataURL("image/jpeg",0.88);
      const provider = document.createElement("select");
      provider.ariaLabel = "Test provider";
      provider.style.cssText = "width:auto;max-width:100%";
      provider.append(new Option("OpenAI","openai"),new Option("Anthropic","anthropic"));
      const run = document.createElement("button");
      run.type = "button";
      run.textContent = "Send this floor for room detection";
      toolbar.append(provider, run);
      status.textContent = "Only the plan inside this outline will be sent.";
      run.onclick = async () => {
        run.disabled = provider.disabled = true;
        status.textContent = "Detecting rooms…";
        try {
          const result = await client.functions.invoke("studio-room-test",{body:{workspaceId,provider:provider.value,image:jpeg}});
          if (!dialog.isConnected) return;
          if (result.error) {
            const detail = await result.error.context?.json?.().catch(()=>null);
            throw new Error(detail?.message || "Room detection is unavailable.");
          }
          const rooms = result.data.rooms;
          const toggle = document.createElement("input");
          toggle.type = "checkbox";
          toggle.checked = true;
          const label = document.createElement("label");
          label.append(toggle," Show proposed rooms");
          toggle.style.cssText = "width:auto;margin:0";
          label.style.cssText = "display:inline-flex;align-items:center;gap:6px";
          toolbar.append(label);
          roomList.hidden = false;
          const heading = document.createElement("strong");
          heading.textContent = "Proposed rooms";
          roomList.append(heading);
          resizePlan();
          function render() {
            ctx.putImageData(clean,0,0);
            if (!toggle.checked) return;
            ctx.strokeStyle = ctx.fillStyle = "#ad245a";
            ctx.lineWidth = 3;
            ctx.font = "16px sans-serif";
            for (const room of rooms) {
              const pts = room.points.map(([x,y])=>[x*canvas.width,y*canvas.height]);
              ctx.beginPath();
              pts.forEach(([x,y],i)=>i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
              ctx.closePath();
              ctx.stroke();
              ctx.fillText(room.label,pts.reduce((v,p)=>v+p[0],0)/pts.length,pts.reduce((v,p)=>v+p[1],0)/pts.length);
            }
          }
          toggle.onchange = render;
          for (const room of rooms) {
            const input = document.createElement("input");
            input.value = room.label;
            input.ariaLabel = "Proposed room name";
            input.oninput = () => {room.label=input.value; render();};
            roomList.append(input);
          }
          let drag;
          function pointer(event) {
            const rect=canvas.getBoundingClientRect();
            return [(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height];
          }
          canvas.onpointerdown = event => {
            if (!toggle.checked) return;
            const [x,y]=pointer(event), rect=canvas.getBoundingClientRect();
            let nearest=14;
            for (const room of rooms) for (const p of room.points) {
              const dist=Math.hypot((p[0]-x)*rect.width,(p[1]-y)*rect.height);
              if(dist<nearest){drag=p; nearest=dist;}
            }
            if(drag) canvas.setPointerCapture(event.pointerId);
          };
          canvas.onpointermove = event => {
            if(!drag) return;
            const [x,y]=pointer(event);
            drag[0]=Math.max(0,Math.min(1,x)); drag[1]=Math.max(0,Math.min(1,y)); render();
          };
          canvas.onlostpointercapture = () => {drag=null;};
          render();
          status.textContent = rooms.length+" proposed rooms. Zoom in to inspect. Drag a corner or edit a label. Closing discards the overlay.";
          run.remove();
        } catch (error) {
          status.textContent = error.message;
          run.disabled = provider.disabled = false;
        }
      };
    } catch (error) {status.textContent = error.message;}
  };
}
