// Copyright (c) 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

Spark = function() {
  chrome.syncFileSystem.requestFileSystem(this.onSyncFileSystemOpened.bind(this));

  var spark = this;

  CodeMirror.commands.autocomplete = function(cm) {
    CodeMirror.showHint(cm, CodeMirror.javascriptHint);
  };

  CodeMirror.commands.closeBuffer = function(cm) {
    if (spark.currentBuffer != null) {
      spark.currentBuffer.userRemoveTab();
    }
  };

  this.editor = CodeMirror(
    document.getElementById("editor"),
    {
      mode: {name: "javascript", json: true },
      lineNumbers: true,
      extraKeys: {"Ctrl-Space": "autocomplete", "Ctrl-W": "closeBuffer"},
    });

  this.editor.on('change', this.onEditorChange.bind(this));

  $("#run-button").click(this.handleRunButton.bind(this));
  $("#export-button").click(this.handleExportButton.bind(this));

  window.addEventListener("bufferSwitch", this.onBufferSwitch.bind(this));
  window.addEventListener("removeBuffer", this.onRemoveBuffer.bind(this));
  window.addEventListener("emptyBuffer", this.onEmptyBuffer.bind(this));
  window.addEventListener("imageBuffer", this.onImageBuffer.bind(this));
  window.addEventListener("imageLoaded", this.onImageLoaded.bind(this));
  
  $('#editor-placeholder-string').html('No file selected');
  Buffer.showEmptyBuffer();

  this.currentBuffer = null;

  // TODO(dvh): the timer should be triggered only if there's a change.
  window.setInterval(this.onSaveTimer.bind(this), 2000);

  $(window).resize(this.onWindowResize.bind(this));
  this.onWindowResize(null);

  $(".tt").tooltip({ 'placement': 'bottom' });

  this.filesListViewController = new FilesListViewController($('#files-listview'), this);
  
  // Add project modal configuration.
  $('#AddProjectModal').on('show', function () {
    spark.modalShown = true;
  });
  $('#AddProjectModal').on('hide', function () {
    spark.modalShown = false;
  });
  $('#AddProjectModal').on('shown', function () {
    $('#new-project-name').val('');
    $('#new-project-name').focus();
  })
  $('#AddFileModal').on('show', function () {
    spark.modalShown = true;
  });
  $('#AddFileModal').on('hide', function () {
    spark.modalShown = false;
  });
  $('#AddFileModal').on('shown', function () {
    $('#new-file-name').val('');
    $('#new-file-name').focus();
  })
  $('#RemoveFilesModal').on('show', function () {
    spark.modalShown = true;
    spark.removeFilesModalShown = true;
  });
  $('#RemoveFilesModal').on('hide', function () {
    spark.modalShown = false;
    spark.removeFilesModalShown = false;
  });
  $('#RemoveFilesModal').on('shown', function () {
    spark.modalShown = true;
  })
  
  $('#new-file-name').keypress(this.onAddFileModalKeyPress.bind(this));
  $('#new-project-name').keypress(this.onAddProjectModalKeyPress.bind(this));
  $('#AddFileModal .btn-primary').click(this.onAddFileModalClicked.bind(this));
  $('#AddProjectModal .btn-primary').click(this.onAddProjectModalClicked.bind(this));
  
  $('#RemoveFilesModal .btn-primary').click(this.onConfirmDeletion.bind(this));
  
  $(document).keydown(this.keyDown.bind(this));
};

Spark.prototype.keyDown = function(e) {
  if (this.modalShown) {
    if (this.removeFilesModalShown) {
      if (e.keyCode == 13) {
        e.preventdefault;
        this.onConfirmDeletion(null);
      }
    }
    return;
  }
  var focused = $(':focus');
  if (focused.size() != 0) {
    return;
  }
  
  if (e.keyCode == 8) {
    e.preventDefault();
    var selection = this.filesListViewController.selection();
    
    if (selection.length == 0) {
      return;
    }
    
    if (selection.length == 1) {
      $('#delete-modal-title').text('Delete ' + selection[0].name + '?');
      $('#delete-modal-description').text('Do you really want to delete ' + selection[0].name + '?');
    } else {
      $('#delete-modal-title').text('Delete ' + selection.length + ' files?');
      $('#delete-modal-description').text('Do you really want to delete ' + selection.length + ' files?');
    }
    
    $('#RemoveFilesModal').modal('show');
  }
}

Spark.prototype.onConfirmDeletion = function(e) {
  var count = 0;
  var spark = this;
  this.filesListViewController.selection().forEach(function(entry, i) {
    if (entry.buffer != null) {
      entry.buffer.userRemoveTab();
    }
    count ++;
    entry.remove(function() {
      // deleted.
      count --;
      if (count == 0) {
        spark.filesListViewController.setSelection([]);
        spark.fileTree.refresh(false, null);
      }
    });
  });
  $('#RemoveFilesModal').modal('hide');
}

// Buttons actions

Spark.prototype.onAddFileModalKeyPress = function(e) {
  if (e.keyCode == 13) {
    e.preventDefault();
    this.onAddFileModalClicked(e);
  }
}

Spark.prototype.onAddProjectModalKeyPress = function(e) {
  if (e.keyCode == 13) {
    e.preventDefault();
    this.onAddProjectModalClicked(e);
  }
}

Spark.prototype.onAddFileModalClicked = function(e) {
  var filename = $('#new-file-name').val();
  var spark = this;
  this.fileTree.createNewFile(filename, function() {
    spark.fileTree.refresh(false, function() {
      console.log('select ' + filename);
      spark.filesListViewController.setSelectionByNames([filename]);
    });
  });
  $('#AddFileModal').modal('hide')
}

Spark.prototype.onAddProjectModalClicked = function(e) {
  var projectName = $('#new-project-name').val();
  this.fileTree.closeOpenedTabs();
  this.ActiveProjectName = projectName;
  this.writePrefs();
  var createProjectCb = function() {
    this.refreshProjectList();
    $('#AddProjectModal').modal('hide')
  };
  this.createProject(this.ActiveProjectName, createProjectCb.bind(this));
}

// Buffers callback.
// TODO(dvh): needs to be refactored using callbacks instead of events.

Spark.prototype.onEmptyBuffer = function(e) {
  $("#editor-pane").hide();
  $("#editor").hide();
  $("#editor-placeholder").show();
  $("#editor-image").hide();
}

Spark.prototype.onImageBuffer = function(e) {
  $("#editor-pane").show();
  $("#editor").hide();
  $("#editor-placeholder").hide();
  $("#editor-image").show();
}

Spark.prototype.onImageLoaded = function(e) {
  if (e.detail.buffer != this.currentBuffer) {
    return;
  }
  this.updateImage();
}

Spark.prototype.updateImage = function() {
  if (this.currentBuffer == null) {
    $("#edited-image").hide();
  } else if (this.currentBuffer.hasImageData) {
    $("#edited-image").show();
    $("#edited-image").one("load", function() {
      $("#edited-image").css('left', ($("#editor-image").width() - $("#edited-image").width()) / 2);
      $("#edited-image").css('top', ($("#editor-image").height() - $("#edited-image").height()) / 2);
    }).attr("src", this.currentBuffer.imageData);
  } else {
    $("#edited-image").hide();
  }
}

Spark.prototype.onRemoveBuffer = function(e) {
  this.closeBufferTab(e.detail.buffer);
};

Spark.prototype.closeBuffer = function(buffer) {
  // Save before closing.
  buffer.save();
  buffer.fileEntry.buffer = null;
  buffer.fileEntry.active = false;
  buffer.removeTab();
}

Spark.prototype.closeBufferTab = function(buffer) {
  var spark = this;
  
  if (buffer == spark.currentBuffer) {
    var currentBufferIndex = spark.currentBuffer.indexInTabs();
    var previousBuffer = null;
  
    this.closeBuffer(buffer);
  
    if (currentBufferIndex > 0) {
      previousBuffer = openedTabEntries[currentBufferIndex - 1];
    } else if (openedTabEntries.length > 0) {
      previousBuffer = openedTabEntries[0];
    }
  
    if (previousBuffer != null) {
      previousBuffer.switchTo();
    } else {
      var emptyDoc = CodeMirror.Doc('');
      spark.editor.swapDoc(emptyDoc);
      Buffer.showEmptyBuffer();
    }
  } else {
    this.closeBuffer(buffer);
  }
}

// Window resize handler.

Spark.prototype.onWindowResize = function(e) {
  var windowWidth = $(window).innerWidth();
  var windowHeight = $(window).innerHeight();
  var topBarHeight = $("#top-bar").outerHeight();
  // Hard-coded size because it won't work on launch. (dvh)
  topBarHeight = 45;
  
  $("#top-bar").width(windowWidth);
  $("#main-view").width(windowWidth);
  var mainViewHeight = windowHeight - topBarHeight;
  $("#main-view").height(mainViewHeight);
  // Hard-coded size because it won't work on launch. (dvh)
  var fileTreePaneWidth = 205;
  // Adds a right margin.
  var editorPaneWidth = windowWidth - fileTreePaneWidth;
  $("#editor-pane").width(editorPaneWidth);
  $("#editor-pane").height(mainViewHeight);
  $("#file-tree").height(mainViewHeight);
  $("#files-listview-container").height(mainViewHeight);
  var filesContainerHeight = $("#files-listview-actions").outerHeight();
  $("#files-listview").css('top', '50px');
  $("#files-listview").height(mainViewHeight - filesContainerHeight - 50);
  var tabsHeight = $('#tabs').outerHeight();
  // Hard-coded size because it won't work on first launch. (dvh)
  tabsHeight = 31 + 50;
  var editorHeight = mainViewHeight - tabsHeight;
  var editorWidth = editorPaneWidth;
  $("#tabs").width(editorWidth);
  $("#editor").css('position', 'absolute');
  $("#editor").css('top', '50px');
  $("#editor").width(editorWidth);
  $("#editor").height(editorHeight);
  $("#editor-placeholder").width(editorPaneWidth);
  $("#editor-placeholder").height(mainViewHeight);
  $("#editor-placeholder div").css('line-height', mainViewHeight + 'px');
  $("#editor-image").width(editorWidth);
  $("#editor-image").height(editorHeight);
  $("#edited-image").css('left', (editorWidth - $("#edited-image").width()) / 2);
  $("#edited-image").css('top', (editorHeight - $("#edited-image").height()) / 2);
  
  $("#editor .CodeMirror").width(editorWidth);
  $("#editor .CodeMirror").height(editorHeight);
  $("#editor .CodeMirror-scroll").width(editorWidth);
  $("#editor .CodeMirror-scroll").height(editorHeight);
}

Spark.prototype.ActiveProjectName = 'untitled';

Spark.prototype.refreshProjectList = function() {
  var menu = $('#project-selector .dropdown-menu');
  menu.empty();
  for (var name in this.projects) {
    // Do not list prefs file as a project.
    if (name == 'prefs')
      continue;
    var menuItem = $('<li><a tabindex="-1">' + htmlEncode(name) + '</a></li>');
    menuItem.click(this.onProjectSelect.bind(this, name));
    menu.append(menuItem)
    if (this.ActiveProjectName == name) {
      $('a', menuItem).addClass('menu-checkmark');
    }
  }
  $('#project-name').html(htmlEncode(this.ActiveProjectName));
};

Spark.prototype.onProjectSelect = function(projectName, e) {
  // TODO(dvh) : remember last loaded project name.
  this.fileTree.closeOpenedTabs();
  this.ActiveProjectName = projectName;
  this.writePrefs();
  this.fileTree.refresh(true, null);
  
  this.refreshProjectList();
};

Spark.prototype.onSaveTimer = function() {
  if (this.currentBuffer)
    this.currentBuffer.save();
};

Spark.prototype.onEditorChange = function(instance, changeObj) {
  if (this.currentBuffer)
    this.currentBuffer.markDirty();
};

Spark.prototype.onBufferSwitch = function(e) {
  if (this.currentBuffer)
    this.currentBuffer.active = false;
  this.currentBuffer = e.detail.buffer;
  var buffer = this.currentBuffer;
  buffer.active = true;

  $("#tabs").children().removeClass("active");
  buffer.tabElement.addClass("active");
  
  if (this.currentBuffer.isImage) {
    Buffer.showImageBuffer();
    this.updateImage();
  } else {
    $("#editor-pane").show();
    $("#editor").show();
    $("#editor-placeholder").hide();
    $("#editor-image").hide();
  }

  this.editor.swapDoc(buffer.doc);
};

Spark.prototype.handleRunButton = function(e) {
  e.preventDefault();
  var exportFolderCb = function() {
    chrome.developerPrivate.loadProject(this.ActiveProjectName,
        function(itemId) {
          setTimeout(function() {
            if (!itemId) {
              console.log('invalid itemId');
              return;
            }
            // Since the API doesn't wait for the item to load,may return
            // before it has fully loaded. Delay the launch event.
            chrome.management.launchApp(itemId, function(){});
            }, 500);
        });
  };
  chrome.developerPrivate.exportSyncfsFolderToLocalfs(
      this.ActiveProjectName, exportFolderCb.bind(this));
};

Spark.prototype.exportProject = function(fileEntry) {
  var zip = new JSZip();

  var writeZipFile = function() {
    fileEntry.createWriter(function(fileWriter) {
      fileWriter.onerror = function(e) {
        console.log("Export failed: " + e.toString());
      };

      var blob = zip.generate({"type": "blob"});
      fileWriter.truncate(blob.size);
      fileWriter.onwriteend = function() {
        fileWriter.onwriteend = function(e) {
          console.log("Export completed.");
        };

        fileWriter.write(blob);
      }
    }, errorHandler);
  }

  var entries = [];
  var zipEntries = function() {
    if (entries.length) {
      var entry = entries.pop();
      if (entry.isFile) {
        entry.file(function(file) {
          var fileReader = new FileReader();
          fileReader.onload = function(e) {
            zip.file(entry.name, e.target.result, { binary: true });
            zipEntries();
          };
          fileReader.onerror = function(e) {
            console.log("Error while zipping: " + e.toString());
          };
          fileReader.readAsBinaryString(file);
        }, errorHandler);
      } else {
        // TODO(miket): handle directories
        zipEntries();
      }
    } else {
      writeZipFile();
    }
  };
  this.filer.ls('.', function(e) {
    entries = e;
    zipEntries();
  });
};

Spark.prototype.handleExportButton = function(e) {
  e.preventDefault();
  chrome.fileSystem.chooseEntry({ "type": "saveFile",
    "suggestedName": this.ActiveProjectName + ".zip" },
    this.exportProject.bind(this));
};

Spark.prototype.loadProjects = function(callback) {
  var reader = this.fileSystem.root.createReader();
  this.projects = {};
  var handleProjectsLs = function(projects) {
    for (var i = 0; i < projects.length; ++i) {
      this.projects[projects[i].name] = projects[i];
      if (projects[i].name == 'prefs')
        continue;
    }
    callback();
  };
  reader.readEntries(handleProjectsLs.bind(this));
};


Spark.prototype.createProject = function(project_name, callback) {
  var handleLoadProject = function(directory) {
    this.activeProject = directory;
    this.projects[project_name] = directory;
    console.log(directory);
    var templateLoadCb = function() {
      this.fileTree.refresh(true, null);
      this.refreshProjectList();
      callback();
    };
    this.templateLoader.loadTemplate(templateLoadCb.bind(this));
  };
  this.fileSystem.root.getDirectory(project_name,{create:true},
      handleLoadProject.bind(this), errorHandler);
};

Spark.prototype.loadPrefsFile = function(callback) {
  var spark = this;
  var handleOpenPrefs = function(entry) {
    spark.prefsEntry = entry;
    entry.file(function(file) {
      var reader = new FileReader();
      reader.readAsText(file, 'utf-8');
      reader.onload = function(ev) {
        // This is the first run of the editor.
        if (!ev.target.result.length) {
          spark.ActiveProjectName = "sample_app";
          spark.writePrefs.bind(spark);
          spark.writePrefs();

          var createProjectCb = function() {
            callback();
          };

          spark.createProject("sample_app", createProjectCb.bind(this));
        } else {
          spark.ActiveProjectName = ev.target.result;
          callback();
        }
      };
    });
  };
  this.filer.fs.root.getFile('prefs', {create: true}, handleOpenPrefs);
};

Spark.prototype.writePrefs = function() {
  var spark = this;
  this.prefsEntry.createWriter(function(writer) {
    writer.truncate(0);
    writer.onwriteend = function() {
      var blob = new Blob([spark.ActiveProjectName]);
      var size = spark.ActiveProjectName.length;
      writer.write(blob);
      writer.onwriteend = function() {
        console.log('prefs file write complete.');
      };
    };
  });
};

Spark.prototype.onSyncFileSystemOpened = function(fs) {
  console.log("Obtained sync file system");
  this.fileSystem = fs;
  this.filer = new Filer(fs);
  this.fileTree = new FileTree(this.filer, this);
  this.templateLoader = new TemplateLoader(this.fileTree, this);
  this.activeProject = this.fileSystem.root;

  var loadPrefsFileCb = function() {
    this.refreshProjectList();
    this.fileTree.refresh(true, null);
  };

  var loadProjectsCb = function() {
    this.loadPrefsFile(loadPrefsFileCb.bind(this));
  };

  this.loadProjects(loadProjectsCb.bind(this));

  var spark = this;
  var dnd = new DnDFileController('body', function(files, e) {
    var items = e.dataTransfer.items;
    for (var i = 0, item; item = items[i]; ++i) {
      var entry = item.webkitGetAsEntry();
      var writeendCb = function() {
        console.log('writes done.');
      }
      if (entry.isDirectory) {
        var reader = entry.createReader();
        var handleDnDFoler = function(entries) {
          var fileEntries = [];
          for (var i = 0; i < entries.length; ++i) {
            if (entries[i].isDirectory) {
              console.log('Directories are not supported currently. Skipping'
                + ' adding: ' + entries[i].name);
              continue;
            }
            fileEntries.push(entries[i]);
          }

          spark.templateLoader.writeFiles(fileEntries, writeendCb);
          for (var i = 0; i < fileEntries.length; ++i) {
            spark.fileTree.createNewFile(fileEntries[i].name, function() {});
          }

        };
        reader.readEntries(handleDnDFoler.bind(this));
      } else {
        spark.templateLoader.writeFiles([entry], writeendCb);
        spark.fileTree.createNewFile(entry.name, function() {});
      }
    }
  });
};

// FileTree callbacks.

Spark.prototype.fileViewControllerSetSelection = function(selectedEntries) {
  this.filesListViewController.setSelection(selectedEntries);
}

Spark.prototype.fileViewControllerTreeUpdated = function(entries) {
  this.filesListViewController.updateEntries(entries);
}

// FilesListViewController callback

Spark.prototype.filesListViewControllerSelectionChanged = function(selectedEntries) {
  // Do nothing.
}

Spark.prototype.filesListViewControllerDoubleClicked = function(selectedEntries) {
  if (selectedEntries.length == 1) {
    this.fileTree.openFileEntry(selectedEntries[0]);
  }
}

$(function() {
  var spark = new Spark();
});
