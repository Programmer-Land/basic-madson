importScripts("https://cdn.jsdelivr.net/pyodide/v0.21.3/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.0/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.0/dist/wheels/panel-0.14.0-py3-none-any.whl', 'matplotlib', 'numpy', 'pandas']
  for (const pkg of env_spec) {
    const pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    await self.pyodide.runPythonAsync(`
      import micropip
      await micropip.install('${pkg}');
    `);
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

import numpy as np
import pandas as pd
from matplotlib.figure import Figure

data_url = "https://cdn.jsdelivr.net/gh/holoviz/panel@master/examples/assets/occupancy.csv"
data = pd.read_csv(data_url, parse_dates=["date"]).set_index("date")

primary_color = "#0072B5"
secondary_color = "#94EA84"


def mpl_plot(avg, highlight):
    fig = Figure(figsize=(10,5))
    ax = fig.add_subplot()
    avg.plot(ax=ax, c=primary_color)
    if len(highlight):
        highlight.plot(style="o", ax=ax, c=secondary_color)
    return fig


def find_outliers(variable="Temperature", window=20, sigma=10, view_fn=mpl_plot):
    avg = data[variable].rolling(window=window).mean()
    residual = data[variable] - avg
    std = residual.rolling(window=window).std()
    outliers = np.abs(residual) > std * sigma
    return view_fn(avg, avg[outliers])


# Panel
import panel as pn

pn.extension(sizing_mode="stretch_width", template="fast")

# Define labels and widgets
pn.pane.Markdown("Variable").servable(area="sidebar")
variable = pn.widgets.RadioBoxGroup(
    name="Variable", value="Temperature", options=list(data.columns), margin=(-10, 5, 10, 10)
).servable(area="sidebar")
window = pn.widgets.IntSlider(name="Window", value=20, start=1, end=60).servable(area="sidebar")

# Make your functions interactive, i.e. react to changes in widget values
ifind_outliers = pn.bind(find_outliers, variable, window, 10)

# Layout the interactive functions
pn.panel(ifind_outliers, sizing_mode="scale_both").servable()

# Configure the template
pn.state.template.param.update(
    site="Panel", title="Getting Started Example",
    accent_base_color=primary_color, header_background=primary_color,
)

await write_doc()
  `
  const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
  self.postMessage({
    type: 'render',
    docs_json: docs_json,
    render_items: render_items,
    root_ids: root_ids
  });
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()