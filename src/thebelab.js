import $ from "jquery";
import CodeMirror from "codemirror/lib/codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/monokai.css";
import "codemirror/addon/hint/show-hint";
import "codemirror/addon/display/autorefresh.js";

var Convert = require('ansi-to-html');
var convert = new Convert();

// make CodeMirror public for loading additional themes
if (typeof window !== "undefined") {
  window.CodeMirror = CodeMirror;
}

import { Widget } from "@lumino/widgets";
import { KernelManager, KernelAPI } from "@jupyterlab/services";
import { ServerConnection } from "@jupyterlab/services";
import { MathJaxTypesetter } from "@jupyterlab/mathjax2";
import { OutputArea, OutputAreaModel } from "@jupyterlab/outputarea";
import {
  RenderMimeRegistry,
  standardRendererFactories,
} from "@jupyterlab/rendermime";
import {
  WIDGET_MIMETYPE,
  WidgetRenderer,
} from "@jupyter-widgets/html-manager/lib/output_renderers";
import { ThebeManager } from "./manager";
import { requireLoader } from "@jupyter-widgets/html-manager";

import { Mode } from "@jupyterlab/codemirror";

// import "@jupyterlab/theme-light-extension/style/index.css";
import "@jupyter-widgets/controls/css/widgets-base.css";
// import "@jupyterlab/rendermime/style/index.css";
import "./index.css";

// Exposing @jupyter-widgets/base and @jupyter-widgets/controls as amd
// modules for custom widget bundles that depend on it.

import * as base from "@jupyter-widgets/base";
import * as controls from "@jupyter-widgets/controls";

if (typeof window !== "undefined" && typeof window.define !== "undefined") {
  window.define("@jupyter-widgets/base", base);
  window.define("@jupyter-widgets/controls", controls);
}

// events

export const events = $({});
export const on = function () {
  events.on.apply(events, arguments);
};
export const one = function () {
  events.one.apply(events, arguments);
};
export const off = function () {
  events.off.apply(events, arguments);
};

// options

const _defaultOptions = {
  bootstrap: false,
  preRenderHook: false,
  stripPrompts: false,
  requestKernel: false,
  predefinedOutput: true,
  mathjaxUrl: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.5/MathJax.js",
  mathjaxConfig: "TeX-AMS_CHTML-full,Safe",
  selector: "[data-executable]",
  outputSelector: "[data-output]",
  kernelOptions: {
    path: "/",
    serverSettings: {
      appendToken: true,
    },
  },
};

export function mergeOptions(options) {
  let merged = {};
  $.extend(true, merged, _defaultOptions);
  if (options) $.extend(true, merged, options);
  return merged;
}

export function getOption(key) {
  return mergeOptions()[key];
}

let _renderers = undefined;
function getRenderers(options) {
  if (!_renderers) {
    _renderers = standardRendererFactories.filter((f) => {
      // filter out latex renderer if mathjax is unavailable
      if (f.mimeTypes.indexOf("text/latex") >= 0) {
        if (options.mathjaxUrl) {
          return true;
        } else {
          console.log("MathJax unavailable");
          return false;
        }
      } else {
        return true;
      }
    });
  }
  return _renderers;
}
// rendering cells

function renderCell(element, manager1, options) {
  // render a single cell
  // element should be a `<pre>` tag with some code in it
  let mergedOptions = mergeOptions(options);
  mergedOptions.manager = manager1;
  let $cell = $("<div class='thebelab-cell'/>");
  let $element = $(element);
  let $output = $element.next(mergedOptions.outputSelector);
  let source = $element.text().trim();
  let renderers = {
    initialFactories: getRenderers(mergedOptions),
  };
  if (mergedOptions.mathjaxUrl) {
    renderers.latexTypesetter = new MathJaxTypesetter({
      url: mergedOptions.mathjaxUrl,
      config: mergedOptions.mathjaxConfig,
    });
  }
  let renderMime = new RenderMimeRegistry(renderers);

  let manager = options.manager;

  renderMime.addFactory(
    {
      safe: false,
      mimeTypes: [WIDGET_MIMETYPE],
      createRenderer: (options) => new WidgetRenderer(options, manager),
    },
    1
  );

  let model = new OutputAreaModel({ trusted: true });

  let outputArea = new OutputArea({
    model: model,
    rendermime: renderMime,
  });

  $cell.attr("id", $element.attr("id"));

  $element.replaceWith($cell);

  let $cm_element = $("<div class='thebelab-input'>");
  $cell.append($cm_element);

  if ($output.length && mergedOptions.predefinedOutput) {
    outputArea.model.add({
      output_type: "display_data",
      data: {
        "text/html": $output.html(),
      },
    });
    $output.remove();
  }

  function setOutputText(text = "Waiting for kernel...") {
    outputArea.model.clear();
    outputArea.model.add({
      output_type: "stream",
      name: "stdout",
      text,
    });
  }

  function get_kernel() {
    let kernel = $cell.data("kernel");
    if (!kernel) {
      console.debug("No kernel connected");
      setOutputText();
      events.trigger("request-kernel");
    }
    return kernel;
  }

  function handle_error(error) {
    outputArea.model.clear();
    outputArea.model.add({
      output_type: "stream",
      name: "stderr",
      text: `Failed to execute. ${error} Please refresh the page.`,
    });
  }

  function execute() {
    const kernel = get_kernel();
    const code = cm.getValue();
    try {
      outputArea.future = kernel.requestExecute({ code: code });
      if (mergedOptions.on_execute) {
        mergedOptions.on_execute(cm);
      }
      const observer = new MutationObserver((mutation_list, observer) => {
        if (mergedOptions.on_output_change) {
          mergedOptions.on_output_change(outputArea.node);
        }
      })
      observer.observe(outputArea.node, { childList: true, subtree: true, });
    } catch (error) {
      handle_error(error);
    }
    return false;
  }

  function code_completion() {
    const kernel = get_kernel();
    let code = cm.getValue();
    const cursor = cm.getDoc().getCursor();
    try {
      kernel.requestComplete({ code: code, cursor_pos: cm.getDoc().indexFromPos(cursor) }).then((value) => {
        const from = cm.getDoc().posFromIndex(value.content.cursor_start);
        const to = cm.getDoc().posFromIndex(value.content.cursor_end);
        cm.showHint({container: $cell[0], hint: () => { return {
          from: from,
          to: to,
          list: value.content.matches
        }}});
      });
    } catch (error) {
      handle_error(error);
    }
  }

  let docs_box = undefined;

  function close_docs_box() {
    if (docs_box) {
      $cell[0].removeChild(docs_box);
      docs_box = undefined;
    }
  }

  function code_introspection() {
    close_docs_box();
    const kernel = get_kernel();
    const code = cm.getValue();
    const cursor = cm.getDoc().getCursor();
    const coords = cm.cursorCoords(cursor);
    console.log(coords);
    try {
      kernel.requestInspect({
        code: code,
        cursor_pos: cm.getDoc().indexFromPos(cursor),
        detail_level: 1
      }).then((msg) => {
        const content = msg.content;
        if (content.status === "ok" && content.found) {
          const text = convert.toHtml(content.data["text/plain"]);
          var htmlNode =document.createElement("pre");
          htmlNode.classList.add("docs-tooltip");
          htmlNode.innerHTML = text;
          htmlNode.style.position = "absolute";
          htmlNode.style.top = "";
          htmlNode.style.left = "";
          htmlNode.style.right = "";
          $cell.append(htmlNode);
          docs_box = htmlNode;
          htmlNode.addEventListener("dblclick", close_docs_box);
        } else {
          console.log(content);
        }
      });
    } catch (error) {
      handle_error(error);
    }
  }

  let theDiv = document.createElement("div");
  $cell.append(theDiv);
  Widget.attach(outputArea, theDiv);

  const isReadOnly = $element.data("readonly");
  const required = {
    value: source,
    theme: mergedOptions.codeMirrorConfig.theme,
    extraKeys: {
      "Shift-Enter": execute,
      "Ctrl-Space": code_completion,
      "Alt": () => {
        if (docs_box) {
          close_docs_box();
        } else {
          cm.display.input.blur();
        }
      },
      "Shift-Tab": code_introspection,
    },
    autoRefresh:true,
  };
  if (isReadOnly !== undefined) {
    required.readOnly = isReadOnly !== false; //overrides codeMirrorConfig.readOnly for cell
  }

  // Gets CodeMirror config if it exists
  let codeMirrorOptions = {};
  if ("codeMirrorConfig" in mergedOptions) {
    codeMirrorOptions = mergedOptions.codeMirrorConfig;
  }

  // Dynamically loads CSS for a given theme
  if ("theme" in codeMirrorOptions) {
    require(`codemirror/theme/${codeMirrorOptions.theme}.css`);
  }

  let codeMirrorConfig = Object.assign(codeMirrorOptions || {}, required);
  let cm = new CodeMirror($cm_element[0], codeMirrorConfig);
  Mode.ensure(codeMirrorConfig.mode).then((modeSpec) => {
    cm.setOption("mode", codeMirrorConfig.mode);
  });
  if (cm.isReadOnly()) {
    cm.display.lineDiv.setAttribute("data-readonly", "true");
    $cm_element[0].setAttribute("data-readonly", "true");
    $cell.attr("data-readonly", "true");
  }
  return { cell: $cell, execute, setOutputText, cm: cm };
}

export function renderAllCells(manager, { selector = _defaultOptions.selector } = {}, options) {
  // render all elements matching `selector` as cells.
  // by default, this is all cells with `data-executable`

  return $(selector).map((i, cell) =>
    renderCell(cell, manager, options)
  );
}

export function hookupKernel(kernel, cells) {
  // hooks up cells to the kernel
  cells.map((i, { cell }) => {
    $(cell).data("kernel", kernel);
  });
}

// requesting Kernels

export function requestKernel(kernelOptions) {
  // request a new Kernel
  kernelOptions = mergeOptions({ kernelOptions }).kernelOptions;
  let serverSettings = ServerConnection.makeSettings(
    kernelOptions.serverSettings
  );
  events.trigger("status", {
    status: "starting",
    message: "Starting Kernel",
  });
  let km = new KernelManager({ serverSettings });
  return km.ready
    .then(() => {
      return km.startNew(kernelOptions);
    })
    .then((kernel) => {
      events.trigger("status", {
        status: "ready",
        message: "Kernel is ready",
        kernel: kernel,
      });
      return kernel;
    });
}

/**
 * Do it all in one go.

 * 1. load options
 * 2. run hooks
 * 3. render cells
 * 4. request a Kernel
 * 5. hook everything up

 * @param {Object} options Object containing thebe options.
 * Same structure as x-thebe-options.
 * @returns {Promise} Promise for connected Kernel object

 */

export function bootstrap(options) {
  // bootstrap thebe on the page
  // merge defaults, pageConfig, etc.
  options = mergeOptions(options);

  if (options.preRenderHook) {
    options.preRenderHook();
  }

  let manager = new ThebeManager({
    loader: requireLoader,
  });

  // bootstrap thebelab on the page
  let cells = renderAllCells(manager, {
    selector: options.selector,
  }, options);

  function getKernel() {
    return requestKernel(options.kernelOptions);
  }

  let kernelPromise;
  kernelPromise = getKernel();

  kernelPromise.then((kernel) => {
    // debug
    manager.registerWithKernel(kernel);
    if (typeof window !== "undefined") window.thebeKernel = kernel;
    hookupKernel(kernel, cells);
  });
  if (window.thebelab) window.thebelab.cells = cells;
  return kernelPromise;
}
