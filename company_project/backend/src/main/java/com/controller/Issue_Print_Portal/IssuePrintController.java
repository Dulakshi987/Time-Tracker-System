package com.controller.Issue_Print_Portal;

import com.entity.IssuePrint;
import com.repository.DocumentRepository;
import com.service.IssuePrintService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import com.entity.Document;


@RestController
@RequestMapping("/api/issue-print")
@CrossOrigin(origins = "*")
public class IssuePrintController {

    @Autowired
    private IssuePrintService service;
     private DocumentRepository repo;

     @GetMapping
    public List<Document> getAll() {
        return repo.findAll();
    }

    @PostMapping("/save")
        public IssuePrint save(@RequestBody IssuePrint issue) {
            return repository.save(issue);
        }

     @PutMapping("/start/{id}")
    public IssuePrint start(@PathVariable Long id) {
        return service.startIssue(id);
    }

    @PutMapping("/end/{id}")
    public IssuePrint end(@PathVariable Long id) {
        return service.endIssue(id);
    }
}