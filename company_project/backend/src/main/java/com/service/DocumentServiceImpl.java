package com.service;

import com.entity.Document;
import com.repository.DocumentRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class DocumentServiceImpl implements DocumentService {

    @Autowired
    private DocumentRepository repo;

    @Override
    public Document save(Document doc) {
        doc.setStatus("Print Pending");
        return repo.save(doc);
    }

    @Override
    public List<Document> getAll() {
        return repo.findAll();
    }

    @Override
    public List<Document> getByType(String type) {
        return repo.findByJobType(type);
    }
}