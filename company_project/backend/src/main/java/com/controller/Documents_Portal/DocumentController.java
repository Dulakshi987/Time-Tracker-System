package com.controller.Documents_Portal;

import com.entity.Document;
import com.service.DocumentService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

@RestController
@RequestMapping("/api/documents")
@CrossOrigin("*")
public class DocumentController {

    @Autowired
    private DocumentService service;

   @PostMapping("/api/documents")
    public Document create(@RequestBody Document doc) {
        doc.setRequestDate(LocalDate.now().toString());
        doc.setRequestTime(LocalTime.now().toString());
        doc.setStatus("Print Pending");
        return service.save(doc);
    }

    @GetMapping
    public List<Document> getAll() {
        return service.getAll();
    }

    @GetMapping("/type/{type}")
    public List<Document> getByType(@PathVariable String type) {
        return service.getByType(type);
    }
}